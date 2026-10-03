import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelClaimBootstrapCoordinator,
  DuelClaimBootstrapError,
} from '../src/duel/duelClaim'
import { isDuelMatchRouteUrl } from '../src/duel/duelInvitation'
import {
  DUEL_PENDING_CLAIM_KEY,
  participantStorageKey,
  readParticipant,
  readPendingClaim,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const PARTICIPANT_B_TOKEN = `3cb_pb1_${'b'.repeat(42)}A`
const PROMOTED_B_TOKEN = INVITATION_TOKEN
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const INVITE_URL = `https://example.test/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`
const CLEAN_URL = `https://example.test/duel/${MATCH_ID}`
const CREATED_AT = '2026-01-01T00:00:00.000Z'
const CLAIMED_AT = '2026-01-01T00:01:00.000Z'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  constructor(private readonly events: string[] = []) {}
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    this.values.set(key, value)
    this.events.push(`storage:set:${key}`)
  }
  removeItem(key: string) {
    this.values.delete(key)
    this.events.push(`storage:remove:${key}`)
  }
}

const cryptoFixture = {
  calls: 0,
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    this.calls += 1
    if (array instanceof Uint8Array) array.fill(11)
    return array
  },
}

function claimResponse(overrides: Record<string, unknown> = {}) {
  return {
    matchId: MATCH_ID,
    totalRounds: 5,
    participant: { role: 'B', token: PROMOTED_B_TOKEN },
    createdAt: CREATED_AT,
    claimedAt: CLAIMED_AT,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    ...overrides,
  }
}

function getResponse(overrides: Record<string, unknown> = {}) {
  return {
    matchId: MATCH_ID,
    totalRounds: 5,
    role: 'B',
    createdAt: CREATED_AT,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked: false },
    opponent: { claimed: true, placementLocked: true },
    ...overrides,
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

async function expectFailure(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelClaimBootstrapError)
    assert(!error.message.includes(INVITATION_TOKEN))
    assert(!error.message.includes(PARTICIPANT_B_TOKEN))
    return
  }
  assert.fail('Expected safe claim bootstrap failure')
}

function setParticipant(
  storage: MemoryStorage,
  role: 'A' | 'B',
  token: string,
) {
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role, token }),
  )
}

async function runNormal(status = 201) {
  const events: string[] = []
  const storage = new MemoryStorage(events)
  const requests: Array<{ url: string; init?: RequestInit }> = []
  let getCount = 0
  const coordinator = createDuelClaimBootstrapCoordinator({
    storage,
    history: {
      replaceState(_data, _unused, url) {
        events.push(`history:${String(url)}`)
      },
    },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      events.push(`fetch:${url}`)
      if (url.endsWith('/claim')) return json(claimResponse(), status)
      getCount += 1
      if (getCount === 1) {
        return json({ error: { code: 'match_unavailable' } }, 404)
      }
      return json(getResponse())
    },
  })
  const result = await coordinator.run(INVITE_URL)
  return { events, storage, requests, result }
}

cryptoFixture.calls = 0
const initial = await runNormal(201)
assert.equal(initial.result.kind, 'participant-b')
assert.equal(cryptoFixture.calls, 1)
assert.deepEqual(initial.requests.map((request) => request.url), [
  `/api/duel/matches/${MATCH_ID}`,
  `/api/duel/matches/${MATCH_ID}/claim`,
  `/api/duel/matches/${MATCH_ID}`,
])
const pendingWrite = initial.events.indexOf(`storage:set:${DUEL_PENDING_CLAIM_KEY}`)
const claimFetch = initial.events.indexOf(`fetch:/api/duel/matches/${MATCH_ID}/claim`)
const cleanup = initial.events.indexOf(`history:/duel/${MATCH_ID}`)
assert(pendingWrite >= 0 && pendingWrite < claimFetch && claimFetch < cleanup)
assert.equal(
  new Headers(initial.requests[1].init?.headers).get('Authorization'),
  `Bearer ${INVITATION_TOKEN}`,
)
const firstClaimBody = JSON.parse(String(initial.requests[1].init?.body))
assert.deepEqual(Object.keys(firstClaimBody), ['claimRecoverySecret'])
assert.equal(firstClaimBody.claimRecoverySecret.length, 43)
assert.equal(
  new Headers(initial.requests[2].init?.headers).get('Authorization'),
  `Bearer ${PROMOTED_B_TOKEN}`,
)
assert.equal(readParticipant(initial.storage, MATCH_ID)?.role, 'B')
assert.equal(readParticipant(initial.storage, MATCH_ID)?.token, PROMOTED_B_TOKEN)
assert.equal(readPendingClaim(initial.storage), null)

const retryStatus = await runNormal(200)
assert.equal(retryStatus.result.kind, 'participant-b')

for (const invalidResponse of [
  claimResponse({ matchId: '22222222-2222-4222-8222-222222222222' }),
  claimResponse({ participant: { role: 'A', token: PARTICIPANT_A_TOKEN } }),
  claimResponse({ participant: { role: 'B', token: 'bad' } }),
]) {
  const storage = new MemoryStorage()
  await expectFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history: { replaceState() {} },
      crypto: cryptoFixture,
      fetch: async (input) =>
        String(input).endsWith('/claim')
          ? json(invalidResponse, 201)
          : json({ error: { code: 'match_unavailable' } }, 404),
    }).run(INVITE_URL),
  )
  assert(readPendingClaim(storage))
}

for (const invalidState of [
  getResponse({ role: 'A' }),
  getResponse({ self: { claimed: false, placementLocked: false } }),
]) {
  const storage = new MemoryStorage()
  let gets = 0
  await expectFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history: { replaceState() {} },
      crypto: cryptoFixture,
      fetch: async (input) => {
        if (String(input).endsWith('/claim')) return json(claimResponse(), 201)
        gets += 1
        return gets === 1
          ? json({ error: { code: 'match_unavailable' } }, 404)
          : json(invalidState)
      },
    }).run(INVITE_URL),
  )
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'B')
}

const lossEvents: string[] = []
const lossStorage = new MemoryStorage(lossEvents)
let lossClaimAttempts = 0
let lossServerClaimed = false
const lossBodies: string[] = []
const lossDependencies = {
  storage: lossStorage,
  history: { replaceState() { lossEvents.push('history') } },
  crypto: cryptoFixture,
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/claim')) {
      lossClaimAttempts += 1
      lossBodies.push(String(init?.body))
      if (lossClaimAttempts === 1) {
        lossServerClaimed = true
        throw new Error('response lost')
      }
      return json(claimResponse(), 200)
    }
    if (lossServerClaimed && lossClaimAttempts >= 1) {
      return json(getResponse())
    }
    return json({ error: { code: 'match_unavailable' } }, 404)
  },
}
await expectFailure(() =>
  createDuelClaimBootstrapCoordinator(lossDependencies).run(INVITE_URL),
)
assert(readPendingClaim(lossStorage))
assert(!lossEvents.includes('history'))
const recoverySecret = readPendingClaim(lossStorage)!.claimRecoverySecret
/* Clean-URL retry with pending secret (legacy recovery path). */
const recovered = await createDuelClaimBootstrapCoordinator(lossDependencies).run(CLEAN_URL)
assert.equal(recovered.kind, 'participant-b')
assert.equal(lossClaimAttempts, 2)
assert.equal(JSON.parse(lossBodies[0]).claimRecoverySecret, recoverySecret)
assert.equal(JSON.parse(lossBodies[1]).claimRecoverySecret, recoverySecret)

const bStorage = new MemoryStorage()
setParticipant(bStorage, 'B', PARTICIPANT_B_TOKEN)
const bRequests: string[] = []
let bCleanup = 0
const bResult = await createDuelClaimBootstrapCoordinator({
  storage: bStorage,
  history: { replaceState() { bCleanup += 1 } },
  crypto: cryptoFixture,
  fetch: async (input, init) => {
    bRequests.push(String(input))
    const url = String(input)
    const auth = new Headers(init?.headers).get('Authorization')
    if (url.endsWith('/claim')) {
      return json({ error: { code: 'invitation_unavailable' } }, 404)
    }
    if (auth === `Bearer ${INVITATION_TOKEN}`) {
      return json({ error: { code: 'match_unavailable' } }, 404)
    }
    return json(getResponse())
  },
}).run(INVITE_URL)
assert.equal(bResult.kind, 'participant-b')
assert.equal(readParticipant(bStorage, MATCH_ID)?.token, PARTICIPANT_B_TOKEN)
assert.equal(bCleanup, 1)

/* URL B capability replaces prior A after successful auth */
const aStorage = new MemoryStorage()
setParticipant(aStorage, 'A', PARTICIPANT_A_TOKEN)
let aGets = 0
const aResult = await createDuelClaimBootstrapCoordinator({
  storage: aStorage,
  history: { replaceState() {} },
  crypto: cryptoFixture,
  fetch: async (input) => {
    if (String(input).endsWith('/claim')) return json(claimResponse(), 201)
    aGets += 1
    return aGets === 1
      ? json({ error: { code: 'match_unavailable' } }, 404)
      : json(getResponse())
  },
}).run(INVITE_URL)
assert.equal(aResult.kind, 'participant-b')
assert.equal(readParticipant(aStorage, MATCH_ID)?.role, 'B')
assert.equal(readParticipant(aStorage, MATCH_ID)?.token, PROMOTED_B_TOKEN)

assert.equal(isDuelMatchRouteUrl('https://example.test/'), false)
assert.equal(isDuelMatchRouteUrl(INVITE_URL), true)
assert.equal(new URL(INVITE_URL).search, '')

let release!: () => void
const wait = new Promise<void>((resolve) => { release = resolve })
const doubleStorage = new MemoryStorage()
let duplicateClaims = 0
let doubleGets = 0
const doubleCoordinator = createDuelClaimBootstrapCoordinator({
  storage: doubleStorage,
  history: { replaceState() {} },
  crypto: cryptoFixture,
  fetch: async (input) => {
    if (String(input).endsWith('/claim')) {
      duplicateClaims += 1
      await wait
      return json(claimResponse(), 201)
    }
    doubleGets += 1
    return doubleGets === 1
      ? json({ error: { code: 'match_unavailable' } }, 404)
      : json(getResponse())
  },
})
const first = doubleCoordinator.run(INVITE_URL)
const second = doubleCoordinator.run(INVITE_URL)
assert.equal(first, second)
release()
await Promise.all([first, second])
assert.equal(duplicateClaims, 1)

for (const file of [
  'src/duel/duelClaim.ts',
  'src/components/DuelClaimBootstrap.tsx',
]) {
  const source = await readFile(file, 'utf8')
  assert(!source.includes('../server/'))
  assert(!source.includes('node:crypto'))
  assert(!source.includes('console.'))
  assert(!source.includes('Math.random'))
}
assert(!new DuelClaimBootstrapError().message.includes(INVITATION_TOKEN))

console.log('verify-duel-claim-client: all checks passed')
