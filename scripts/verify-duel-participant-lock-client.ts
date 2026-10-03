import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDuelALockCoordinator } from '../src/duel/duelCreateLock'
import {
  createDuelBLockCoordinator,
  DuelParticipantLockError,
} from '../src/duel/duelParticipantLock'
import {
  DUEL_PENDING_LOCK_KEY,
  completeParticipantBClaim,
  createPendingClaimRecord,
  participantStorageKey,
  readARecoveryState,
  readBRecoveryState,
  readParticipant,
  savePendingClaim,
  savePendingLock,
  type StorageAdapter,
  DuelStorageError,
} from '../src/duel/duelPersistence'
import type { DuelRoundPlacement } from '../src/game/duelPlacement'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH_ID = '22222222-2222-4222-8222-222222222222'
const B_TOKEN = `3cb_pb1_${'b'.repeat(42)}A`
const A_TOKEN = `3cb_pa1_${'a'.repeat(42)}A`
const INVITE_TOKEN = `3cb_pi1_${'c'.repeat(42)}A`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function bStateResponse(placementLocked = true) {
  return {
    matchId: MATCH_ID,
    totalRounds: 2,
    role: 'B',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked },
    opponent: { claimed: true, placementLocked: true },
  }
}

function setParticipant(
  storage: MemoryStorage,
  role: 'A' | 'B',
  token: string,
  matchId = MATCH_ID,
) {
  storage.setItem(
    participantStorageKey(matchId),
    JSON.stringify({ version: 1, matchId, role, token }),
  )
}

async function expectBFailure(
  action: () => Promise<unknown>,
): Promise<DuelParticipantLockError> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelParticipantLockError)
    assert(!error.message.includes(B_TOKEN))
    return error
  }
  assert.fail('Expected a safe B LOCK failure')
}

async function main() {
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', B_TOKEN)
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === '/api/duel/matches') {
      assert.fail('B must not create a match')
    }
    if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
    return json(bStateResponse())
  }
  const coordinator = createDuelBLockCoordinator({
    storage,
    fetch: fetchMock,
  })
  await coordinator.run({ matchId: MATCH_ID, totalRounds: 2, placements })

  assert.deepEqual(calls.map((call) => call.url), [
    `/api/duel/matches/${MATCH_ID}/placements/lock`,
    `/api/duel/matches/${MATCH_ID}`,
  ])
  assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), `Bearer ${B_TOKEN}`)
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).placements[0].coinBagNumbers, [
    1, 1, 2,
  ])
  assert.equal(storage.getItem(DUEL_PENDING_LOCK_KEY), null)

  const lockRetryStorage = new MemoryStorage()
  setParticipant(lockRetryStorage, 'B', B_TOKEN)
  savePendingLock(lockRetryStorage, {
    version: 1,
    phase: 'pending-lock',
    matchId: MATCH_ID,
    placements: [
      {
        roundNumber: 1,
        bagCount: 3,
        bombBagNumber: 3,
        coinBagNumbers: [1, 1, 2],
      },
      {
        roundNumber: 2,
        bagCount: 4,
        bombBagNumber: 1,
        coinBagNumbers: [2, 4, 4],
      },
    ],
  })
  let lockAttempts = 0
  let createCalls = 0
  const lockRetryCoordinator = createDuelBLockCoordinator({
    storage: lockRetryStorage,
    fetch: async (input) => {
      const url = String(input)
      if (url === '/api/duel/matches') {
        createCalls += 1
        return json({})
      }
      if (url.endsWith('/placements/lock')) {
        lockAttempts += 1
        if (lockAttempts === 1) throw new Error('lost response')
        return json({ placementLocked: true })
      }
      return json(bStateResponse())
    },
  })
  await expectBFailure(() =>
    lockRetryCoordinator.run({ matchId: MATCH_ID, totalRounds: 2, placements }),
  )
  assert.equal(readBRecoveryState(lockRetryStorage, MATCH_ID).phase, 'lock-retry')
  await lockRetryCoordinator.run({ matchId: MATCH_ID, totalRounds: 2, placements })
  assert.equal(createCalls, 0)
  assert.equal(lockAttempts, 2)

  const mismatchStorage = new MemoryStorage()
  setParticipant(mismatchStorage, 'B', B_TOKEN)
  savePendingLock(mismatchStorage, {
    version: 1,
    phase: 'pending-lock',
    matchId: MATCH_ID,
    placements: [
      {
        roundNumber: 1,
        bagCount: 3,
        bombBagNumber: 2,
        coinBagNumbers: [1, 1, 3],
      },
    ],
  })
  let mismatchNetwork = 0
  const mismatch = await expectBFailure(() =>
    createDuelBLockCoordinator({
      storage: mismatchStorage,
      fetch: async () => {
        mismatchNetwork += 1
        return json({})
      },
    }).run({ matchId: MATCH_ID, totalRounds: 2, placements }),
  )
  assert.equal(mismatch.code, 'RECOVERY_MISMATCH')
  assert.equal(mismatchNetwork, 0)

  const wrongRoleStorage = new MemoryStorage()
  setParticipant(wrongRoleStorage, 'A', A_TOKEN)
  await expectBFailure(() =>
    createDuelBLockCoordinator({
      storage: wrongRoleStorage,
      fetch: async () => json({}),
    }).run({ matchId: MATCH_ID, totalRounds: 2, placements }),
  )

  const wrongMatchStorage = new MemoryStorage()
  setParticipant(wrongMatchStorage, 'B', B_TOKEN, OTHER_MATCH_ID)
  await expectBFailure(() =>
    createDuelBLockCoordinator({
      storage: wrongMatchStorage,
      fetch: async () => json({}),
    }).run({ matchId: MATCH_ID, totalRounds: 2, placements }),
  )

  const aOverwriteStorage = new MemoryStorage()
  setParticipant(aOverwriteStorage, 'A', A_TOKEN)
  savePendingClaim(
    aOverwriteStorage,
    createPendingClaimRecord(MATCH_ID, INVITE_TOKEN, {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array instanceof Uint8Array) array.fill(9)
        return array
      },
    }),
  )
  completeParticipantBClaim(aOverwriteStorage, {
    matchId: MATCH_ID,
    participantToken: B_TOKEN,
  })
  assert.equal(readParticipant(aOverwriteStorage, MATCH_ID)?.role, 'B')
  assert.equal(readParticipant(aOverwriteStorage, MATCH_ID)?.token, B_TOKEN)

  const bPendingStorage = new MemoryStorage()
  setParticipant(bPendingStorage, 'B', B_TOKEN)
  savePendingLock(bPendingStorage, {
    version: 1,
    phase: 'pending-lock',
    matchId: MATCH_ID,
    placements: [
      {
        roundNumber: 1,
        bagCount: 3,
        bombBagNumber: 3,
        coinBagNumbers: [1, 1, 2],
      },
      {
        roundNumber: 2,
        bagCount: 4,
        bombBagNumber: 1,
        coinBagNumbers: [2, 4, 4],
      },
    ],
  })
  assert.equal(readARecoveryState(bPendingStorage).phase, 'idle')

  let release!: () => void
  const deferred = new Promise<void>((resolve) => {
    release = resolve
  })
  const doubleStorage = new MemoryStorage()
  setParticipant(doubleStorage, 'B', B_TOKEN)
  let doubleLocks = 0
  const doubleCoordinator = createDuelBLockCoordinator({
    storage: doubleStorage,
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/placements/lock')) {
        doubleLocks += 1
        await deferred
        return json({ placementLocked: true })
      }
      return json(bStateResponse())
    },
  })
  const first = doubleCoordinator.run({ matchId: MATCH_ID, totalRounds: 2, placements })
  const second = doubleCoordinator.run({ matchId: MATCH_ID, totalRounds: 2, placements })
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.equal(doubleLocks, 1)

  const aStorage = new MemoryStorage()
  const aCalls: string[] = []
  const aCoordinator = createDuelALockCoordinator({
    storage: aStorage,
    fetch: async (input) => {
      const url = String(input)
      aCalls.push(url)
      if (url === '/api/duel/matches') {
        return json(
          {
            matchId: MATCH_ID,
            totalRounds: 2,
            participant: { role: 'A', token: A_TOKEN },
            invitation: { token: INVITE_TOKEN },
          },
          201,
        )
      }
      if (url.endsWith('/placements/lock')) return json({ placementLocked: true })
      return json({
        matchId: MATCH_ID,
        totalRounds: 2,
        role: 'A',
        self: { claimed: true, placementLocked: true },
        opponent: { claimed: false, placementLocked: false },
      })
    },
    crypto: {
      randomUUID: () => OTHER_MATCH_ID as `${string}-${string}-${string}-${string}-${string}`,
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array instanceof Uint8Array) array.fill(3)
        return array
      },
    },
  })
  await aCoordinator.run({ totalRounds: 2, placements })
  assert(aCalls.includes('/api/duel/matches'))

  const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
  const bootstrapSource = await readFile('src/components/DuelClaimBootstrap.tsx', 'utf8')
  const lockSource = await readFile('src/duel/duelParticipantLock.ts', 'utf8')
  const claimSource = await readFile('src/duel/duelClaim.ts', 'utf8')

  assert(flowSource.includes('createDuelBLockCoordinator'))
  assert(flowSource.includes('participantB'))
  assert(flowSource.includes('createDuelSession(participantB.totalRounds)'))
  assert(!flowSource.includes('duelLockConfirm'))
  assert(flowSource.includes('window.confirm(t.duelStartOverConfirm)'))
  assert(bootstrapSource.includes('initiallyLocked={state.result.state.self.placementLocked}'))
  assert(!lockSource.includes("fetch('/api/duel/matches'"))
  assert(!lockSource.includes('fetch("/api/duel/matches"'))
  assert(!lockSource.includes('../server/'))
  assert(!lockSource.includes('console.'))
  assert(!claimSource.includes('bombBag'))
  assert(!claimSource.includes('coinBag'))

  const getSource = await readFile('server/duel/getMatch.ts', 'utf8')
  assert(!getSource.includes('invite_token_hash'))

  console.log('verify-duel-participant-lock-client: all checks passed')
}

await main()
