import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelClaimBootstrapCoordinator,
  DuelClaimBootstrapError,
} from '../src/duel/duelClaim'
import { buildDuelParticipantUrl } from '../src/duel/duelInvitation'
import {
  DUEL_PENDING_CLAIM_KEY,
  participantStorageKey,
  readParticipant,
  readPendingClaim,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const LEGACY_B_TOKEN = `3cb_pb1_${'b'.repeat(42)}A`
const INVITE_URL = `https://example.test/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`
const A_CAPABILITY_URL = buildDuelParticipantUrl(
  'https://example.test',
  MATCH_ID,
  PARTICIPANT_A_TOKEN,
)
const CREATED_AT = '2026-01-01T00:00:00.000Z'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  constructor(readonly events: string[] = []) {}
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
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
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.fill(3)
    return array
  },
}

function claimResponse() {
  return {
    matchId: MATCH_ID,
    totalRounds: 5,
    participant: { role: 'B', token: INVITATION_TOKEN },
    createdAt: CREATED_AT,
    claimedAt: '2026-01-01T00:01:00.000Z',
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
  }
}

function getBResponse(overrides: Record<string, unknown> = {}) {
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

function getAResponse() {
  return {
    matchId: MATCH_ID,
    totalRounds: 5,
    role: 'A',
    createdAt: CREATED_AT,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked: true },
    opponent: { claimed: true, placementLocked: false },
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
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

async function expectFailure(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelClaimBootstrapError)
    assert(!error.message.includes(INVITATION_TOKEN))
    assert(!error.message.includes(PARTICIPANT_A_TOKEN))
    return
  }
  assert.fail('expected bootstrap failure')
}

/* 1. First claim: GET fails → claim → LS pi1; fragment after success only */
{
  const events: string[] = []
  const storage = new MemoryStorage(events)
  const auth: string[] = []
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: {
      replaceState(_d, _u, url) {
        events.push(`history:${String(url)}`)
      },
    },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      const url = String(input)
      auth.push(new Headers(init?.headers).get('Authorization') ?? '')
      events.push(`fetch:${url}`)
      if (url.endsWith('/claim')) return json(claimResponse(), 201)
      if (auth.filter((value) => value.includes(INVITATION_TOKEN)).length === 1) {
        return json({ error: { code: 'match_unavailable' } }, 404)
      }
      return json(getBResponse())
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'B')
  const claimIdx = events.indexOf(`fetch:/api/duel/matches/${MATCH_ID}/claim`)
  const historyIdx = events.indexOf(`history:/duel/${MATCH_ID}`)
  assert(claimIdx >= 0 && historyIdx > claimIdx)
  assert.equal(auth[0], `Bearer ${INVITATION_TOKEN}`)
}

/* 2–4. Claimed re-entry, empty LS, no new token / no alternate URL */
{
  const events: string[] = []
  const storage = new MemoryStorage(events)
  let claimCalls = 0
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: {
      replaceState(_d, _u, url) {
        events.push(`history:${String(url)}`)
      },
    },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      const url = String(input)
      if (url.endsWith('/claim')) {
        claimCalls += 1
        return json({ error: { code: 'invitation_unavailable' } }, 404)
      }
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${INVITATION_TOKEN}`,
      )
      return json(getBResponse({ self: { claimed: true, placementLocked: true } }))
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(claimCalls, 0)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
  assert.deepEqual(events.filter((e) => e.startsWith('history:')), [
    `history:/duel/${MATCH_ID}`,
  ])
}

/* 5–6. Failure keeps fragment (no history) and LS */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'A', PARTICIPANT_A_TOKEN)
  const before = storage.getItem(participantStorageKey(MATCH_ID))
  const history: string[] = []
  await expectFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history: {
        replaceState(_d, _u, url) {
          history.push(String(url))
        },
      },
      crypto: cryptoFixture,
      fetch: async () => json({ error: { code: 'match_unavailable' } }, 404),
    }).run(INVITE_URL),
  )
  assert.equal(storage.getItem(participantStorageKey(MATCH_ID)), before)
  assert.equal(history.length, 0)
}

/* 7. Response lost: first claim network drop, reopen invite → GET import */
{
  const storage = new MemoryStorage()
  const history: string[] = []
  let claimAttempts = 0
  let serverClaimed = false
  await expectFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history: {
        replaceState(_d, _u, url) {
          history.push(String(url))
        },
      },
      crypto: cryptoFixture,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/claim')) {
          claimAttempts += 1
          serverClaimed = true
          throw new TypeError('response lost')
        }
        return json({ error: { code: 'match_unavailable' } }, 404)
      },
    }).run(INVITE_URL),
  )
  assert.equal(readParticipant(storage, MATCH_ID), null)
  assert(readPendingClaim(storage))
  assert.equal(history.length, 0)

  /* Same browser (pending remains): GET import clears pending, no second claim. */
  const sameBrowser = await createDuelClaimBootstrapCoordinator({
    storage,
    history: {
      replaceState(_d, _u, url) {
        history.push(String(url))
      },
    },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      const url = String(input)
      if (url.endsWith('/claim')) {
        claimAttempts += 1
        return json(claimResponse(), 200)
      }
      assert(serverClaimed)
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${INVITATION_TOKEN}`,
      )
      return json(getBResponse())
    },
  }).run(INVITE_URL)
  assert.equal(sameBrowser.kind, 'participant-b')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
  assert.equal(readPendingClaim(storage), null)
  assert.equal(claimAttempts, 1)
  assert.equal(history[history.length - 1], `/duel/${MATCH_ID}`)

  /* Empty LS new browser: same URL still imports via GET. */
  const emptyRecovered = await createDuelClaimBootstrapCoordinator({
    storage: new MemoryStorage(),
    history: { replaceState() {} },
    crypto: cryptoFixture,
    fetch: async (input) => {
      if (String(input).endsWith('/claim')) {
        assert.fail('claimed re-entry must not claim again')
      }
      return json(getBResponse())
    },
  }).run(INVITE_URL)
  assert.equal(emptyRecovered.kind, 'participant-b')
}

/* 8. LS=A + valid B invite → replace with B after auth */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'A', PARTICIPANT_A_TOKEN)
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      if (String(input).endsWith('/claim')) {
        return json(claimResponse(), 201)
      }
      const auth = new Headers(init?.headers).get('Authorization')
      if (auth === `Bearer ${INVITATION_TOKEN}`) {
        return json(getBResponse())
      }
      return json({ error: { code: 'match_unavailable' } }, 404)
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'B')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
}

/* 9. LS=A + invalid B invite → keep A */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'A', PARTICIPANT_A_TOKEN)
  await expectFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history: { replaceState() {} },
      crypto: cryptoFixture,
      fetch: async () => json({ error: { code: 'match_unavailable' } }, 404),
    }).run(INVITE_URL),
  )
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'A')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, PARTICIPANT_A_TOKEN)
}

/* 10. Empty LS new browser — claimed import */
{
  const storage = new MemoryStorage()
  assert.equal(storage.values.size, 0)
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: cryptoFixture,
    fetch: async (input) => {
      if (String(input).endsWith('/claim')) assert.fail('should import via GET')
      return json(getBResponse())
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
}

/* 11. A #p= regression */
{
  const storage = new MemoryStorage()
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: cryptoFixture,
    fetch: async (_input, init) => {
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${PARTICIPANT_A_TOKEN}`,
      )
      return json(getAResponse())
    },
  }).run(A_CAPABILITY_URL)
  assert.equal(result.kind, 'participant-a')
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'A')
}

/* 13. Legacy pb1 LS + dead invite URL → fallback to LS B */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', LEGACY_B_TOKEN)
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: cryptoFixture,
    fetch: async (input, init) => {
      const url = String(input)
      const auth = new Headers(init?.headers).get('Authorization')
      if (url.endsWith('/claim')) {
        return json({ error: { code: 'invitation_unavailable' } }, 404)
      }
      if (auth === `Bearer ${INVITATION_TOKEN}`) {
        return json({ error: { code: 'match_unavailable' } }, 404)
      }
      assert.equal(auth, `Bearer ${LEGACY_B_TOKEN}`)
      return json(getBResponse())
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, LEGACY_B_TOKEN)
}

const claimSource = await readFile('src/duel/duelClaim.ts', 'utf8')
assert(claimSource.includes('importPromotedBFromInvite'))
assert(claimSource.includes('bootstrapInvitationUrl'))
assert(claimSource.includes('ensureDuelPendingClaim'))
assert(!claimSource.includes('prepareDuelInvitationEntry'))
assert(!claimSource.includes('console.'))

console.log('verify-duel-invite-b-reentry-client: all checks passed')
