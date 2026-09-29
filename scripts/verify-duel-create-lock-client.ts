import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelALockCoordinator,
  DuelCreateLockError,
} from '../src/duel/duelCreateLock'
import {
  DUEL_MATCH_INDEX_KEY,
  DUEL_PENDING_CREATE_KEY,
  DUEL_PENDING_LOCK_KEY,
  createPendingCreateRecord,
  persistCreatedMatchHandoff,
  readARecoveryState,
  savePendingCreate,
  type StorageAdapter,
} from '../src/duel/duelPersistence'
import type { DuelRoundPlacement } from '../src/game/duelPlacement'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const A_TOKEN = `3cb_pa1_${'a'.repeat(42)}A`
const INVITE_TOKEN = `3cb_pi1_${'b'.repeat(42)}A`
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  failSet = false
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('storage failure')
    this.values.set(key, value)
  }
  removeItem(key: string) { this.values.delete(key) }
}

const placements: readonly DuelRoundPlacement[] = [
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagId: 'bag-3',
    coinCountsByBag: { 'bag-1': 2, 'bag-2': 1 },
  },
  {
    roundNumber: 2,
    bagCount: 4,
    bombBagId: 'bag-1',
    coinCountsByBag: { 'bag-2': 1, 'bag-4': 2 },
  },
]

const cryptoFixture = {
  randomUUID: () => REQUEST_ID as `${string}-${string}-${string}-${string}-${string}`,
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.fill(7)
    return array
  },
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function createResponse() {
  return {
    matchId: MATCH_ID,
    totalRounds: 2,
    participant: { role: 'A', token: A_TOKEN },
    invitation: { token: INVITE_TOKEN },
  }
}

function stateResponse(placementLocked = true) {
  return {
    matchId: MATCH_ID,
    totalRounds: 2,
    role: 'A',
    self: { claimed: true, placementLocked },
    opponent: { claimed: false, placementLocked: false },
  }
}

async function expectFailure(action: () => Promise<unknown>): Promise<DuelCreateLockError> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelCreateLockError)
    assert(!error.message.includes(A_TOKEN))
    assert(!error.message.includes(INVITE_TOKEN))
    return error
  }
  assert.fail('Expected a safe DUEL lock failure')
}

async function main() {
  const storage = new MemoryStorage()
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/duel/matches') return json(createResponse(), 201)
    if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
    return json(stateResponse())
  }
  const coordinator = createDuelALockCoordinator({
    storage,
    fetch: fetchMock,
    crypto: cryptoFixture,
  })
  await coordinator.run({ totalRounds: 2, placements })

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/duel/matches',
    `/api/duel/matches/${MATCH_ID}/placements/lock`,
    `/api/duel/matches/${MATCH_ID}`,
  ])
  assert.equal(calls[0].init?.method, 'POST')
  assert.equal(new Headers(calls[0].init?.headers).get('Idempotency-Key'), REQUEST_ID)
  const createBody = JSON.parse(String(calls[0].init?.body))
  assert.deepEqual(Object.keys(createBody).sort(), ['createRecoverySecret', 'totalRounds'])
  assert.equal(createBody.totalRounds, 2)
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), `Bearer ${A_TOKEN}`)
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)).placements[0].coinBagNumbers, [1, 1, 2])
  assert.equal(storage.getItem(DUEL_PENDING_CREATE_KEY), null)
  assert.equal(storage.getItem(DUEL_PENDING_LOCK_KEY), null)
  assert(JSON.parse(storage.getItem(DUEL_MATCH_INDEX_KEY)!).matchIds.includes(MATCH_ID))

  const failedStorage = new MemoryStorage()
  failedStorage.failSet = true
  let networkCalls = 0
  await expectFailure(() => createDuelALockCoordinator({
    storage: failedStorage,
    fetch: async () => { networkCalls += 1; return json({}) },
    crypto: cryptoFixture,
  }).run({ totalRounds: 2, placements }))
  assert.equal(networkCalls, 0)

  const falseStateStorage = new MemoryStorage()
  let falseCalls = 0
  await expectFailure(() => createDuelALockCoordinator({
    storage: falseStateStorage,
    fetch: async (input) => {
      falseCalls += 1
      const url = String(input)
      if (url === '/api/duel/matches') return json(createResponse(), 201)
      if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
      return json(stateResponse(false))
    },
    crypto: cryptoFixture,
  }).run({ totalRounds: 2, placements }))
  assert.equal(falseCalls, 3)
  assert.equal(readARecoveryState(falseStateStorage).phase, 'lock-retry')

  const createRetryStorage = new MemoryStorage()
  const pending = createPendingCreateRecord(placements, 2, cryptoFixture)
  savePendingCreate(createRetryStorage, pending)
  let createAttempts = 0
  const retryCoordinator = createDuelALockCoordinator({
    storage: createRetryStorage,
    fetch: async (input) => {
      const url = String(input)
      if (url === '/api/duel/matches') {
        createAttempts += 1
        if (createAttempts === 1) throw new Error('lost response')
        return json(createResponse())
      }
      if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
      return json(stateResponse())
    },
    crypto: cryptoFixture,
  })
  await expectFailure(() => retryCoordinator.run({ totalRounds: 2, placements }))
  assert.equal(readARecoveryState(createRetryStorage).phase, 'create-retry')
  await retryCoordinator.run({ totalRounds: 2, placements })
  assert.equal(createAttempts, 2)

  const lockRetryStorage = new MemoryStorage()
  savePendingCreate(lockRetryStorage, pending)
  persistCreatedMatchHandoff(lockRetryStorage, {
    matchId: MATCH_ID,
    participantToken: A_TOKEN,
    invitationToken: INVITE_TOKEN,
  })
  let lockAttempts = 0
  let lockCreates = 0
  const lockRetryCoordinator = createDuelALockCoordinator({
    storage: lockRetryStorage,
    fetch: async (input) => {
      const url = String(input)
      if (url === '/api/duel/matches') { lockCreates += 1; return json(createResponse()) }
      if (url.endsWith('/placements/lock')) {
        lockAttempts += 1
        if (lockAttempts === 1) throw new Error('lost response')
        return json({ placementLocked: true })
      }
      return json(stateResponse())
    },
    crypto: cryptoFixture,
  })
  await expectFailure(() => lockRetryCoordinator.run({ totalRounds: 2, placements }))
  assert.equal(readARecoveryState(lockRetryStorage).phase, 'lock-retry')
  await lockRetryCoordinator.run({ totalRounds: 2, placements })
  assert.equal(lockCreates, 0)
  assert.equal(lockAttempts, 2)

  const mismatchStorage = new MemoryStorage()
  savePendingCreate(mismatchStorage, pending)
  let mismatchNetwork = 0
  const changed = placements.map((placement, index) =>
    index === 0 ? { ...placement, bombBagId: 'bag-2', coinCountsByBag: { 'bag-1': 3 } } : placement,
  )
  const mismatch = await expectFailure(() => createDuelALockCoordinator({
    storage: mismatchStorage,
    fetch: async () => { mismatchNetwork += 1; return json({}) },
    crypto: cryptoFixture,
  }).run({ totalRounds: 2, placements: changed }))
  assert.equal(mismatch.code, 'RECOVERY_MISMATCH')
  assert.equal(mismatchNetwork, 0)

  let release!: () => void
  const deferred = new Promise<void>((resolve) => { release = resolve })
  const doubleStorage = new MemoryStorage()
  let doubleCreates = 0
  const doubleCoordinator = createDuelALockCoordinator({
    storage: doubleStorage,
    fetch: async (input) => {
      const url = String(input)
      if (url === '/api/duel/matches') {
        doubleCreates += 1
        await deferred
        return json(createResponse())
      }
      if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
      return json(stateResponse())
    },
    crypto: cryptoFixture,
  })
  const first = doubleCoordinator.run({ totalRounds: 2, placements })
  const second = doubleCoordinator.run({ totalRounds: 2, placements })
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.equal(doubleCreates, 1)

  const source = await readFile('src/duel/duelCreateLock.ts', 'utf8')
  assert(!source.includes('../server/'))
  assert(!source.includes('console.'))
  assert(!source.includes('Math.random'))
  const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
  assert(flowSource.indexOf('await lockCoordinatorRef.current.run') < flowSource.indexOf('lockSession(prev)'))

  console.log('verify-duel-create-lock-client: all checks passed')
}

await main()
