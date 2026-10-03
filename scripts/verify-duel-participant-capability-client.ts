import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelClaimBootstrapCoordinator,
  DuelClaimBootstrapError,
} from '../src/duel/duelClaim'
import {
  buildDuelParticipantUrl,
  classifyDuelMatchUrlFragment,
} from '../src/duel/duelInvitation'
import {
  DuelParticipantCapabilityError,
  importDuelParticipantCapability,
} from '../src/duel/duelParticipantCapability'
import {
  DUEL_MATCH_INDEX_KEY,
  participantStorageKey,
  readMatchIndex,
  readParticipant,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH_ID = '22222222-2222-4222-8222-222222222222'
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const PARTICIPANT_B_TOKEN = `3cb_pb1_${'d'.repeat(42)}A`
const OTHER_B_TOKEN = `3cb_pb1_${'e'.repeat(42)}A`
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const ORIGIN = 'https://example.test'
const CREATED_AT = '2026-01-01T00:00:00.000Z'
const A_URL = buildDuelParticipantUrl(ORIGIN, MATCH_ID, PARTICIPANT_A_TOKEN)
const B_URL = buildDuelParticipantUrl(ORIGIN, MATCH_ID, PARTICIPANT_B_TOKEN)
const INVITE_URL = `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`
const CLEAN_URL = `${ORIGIN}/duel/${MATCH_ID}`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  readonly events: string[] = []
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

class MemoryHistory {
  readonly urls: string[] = []
  replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
    this.urls.push(String(url))
  }
}

const cryptoFixture = {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array instanceof Uint8Array) array.fill(7)
    return array
  },
}

function getResponse(
  role: 'A' | 'B',
  overrides: Record<string, unknown> = {},
) {
  return {
    matchId: MATCH_ID,
    totalRounds: 5,
    role,
    createdAt: CREATED_AT,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked: role === 'A' },
    opponent: { claimed: role === 'B', placementLocked: false },
    ...overrides,
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

function setParticipant(
  storage: MemoryStorage,
  role: 'A' | 'B',
  token: string,
): void {
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role, token }),
  )
}

function snapshotParticipant(storage: MemoryStorage): string | null {
  return storage.getItem(participantStorageKey(MATCH_ID))
}

async function expectCapabilityFailure(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelParticipantCapabilityError)
    assert(!error.message.includes(PARTICIPANT_A_TOKEN))
    assert(!error.message.includes(PARTICIPANT_B_TOKEN))
    assert(!error.message.includes(INVITATION_TOKEN))
    return
  }
  assert.fail('Expected capability import failure')
}

async function expectBootstrapFailure(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelClaimBootstrapError)
    assert(!error.message.includes(PARTICIPANT_A_TOKEN))
    assert(!error.message.includes(PARTICIPANT_B_TOKEN))
    return
  }
  assert.fail('Expected bootstrap failure')
}

assert.equal(classifyDuelMatchUrlFragment(A_URL), 'participant')
assert.equal(classifyDuelMatchUrlFragment(B_URL), 'participant')
assert.equal(classifyDuelMatchUrlFragment(INVITE_URL), 'invite')
assert.equal(classifyDuelMatchUrlFragment(CLEAN_URL), 'none')
assert.equal(
  classifyDuelMatchUrlFragment(`${CLEAN_URL}#p=${PARTICIPANT_A_TOKEN}&invite=${INVITATION_TOKEN}`),
  'invalid',
)

/* 1–4: A import, fragment clean, Bearer-usable storage */
{
  const storage = new MemoryStorage()
  const history = new MemoryHistory()
  const authHeaders: string[] = []
  const result = await importDuelParticipantCapability(A_URL, {
    storage,
    history,
    fetch: async (input, init) => {
      assert.equal(String(input), `/api/duel/matches/${MATCH_ID}`)
      authHeaders.push(new Headers(init?.headers).get('Authorization') ?? '')
      return json(getResponse('A'))
    },
  })
  assert.equal(result.kind, 'participant-a')
  assert.deepEqual(readParticipant(storage, MATCH_ID), {
    version: 1,
    matchId: MATCH_ID,
    role: 'A',
    token: PARTICIPANT_A_TOKEN,
  })
  assert(readMatchIndex(storage).matchIds.includes(MATCH_ID))
  assert.deepEqual(history.urls, [`/duel/${MATCH_ID}`])
  assert.deepEqual(authHeaders, [`Bearer ${PARTICIPANT_A_TOKEN}`])
  const setIndex = storage.events.indexOf(`storage:set:${participantStorageKey(MATCH_ID)}`)
  assert(setIndex >= 0)
  assert(storage.events.indexOf(`storage:set:${DUEL_MATCH_INDEX_KEY}`) > setIndex)
}

/* 2: B import */
{
  const storage = new MemoryStorage()
  const history = new MemoryHistory()
  const result = await importDuelParticipantCapability(B_URL, {
    storage,
    history,
    fetch: async () => json(getResponse('B', {
      self: { claimed: true, placementLocked: false },
      opponent: { claimed: true, placementLocked: true },
    })),
  })
  assert.equal(result.kind, 'participant-b')
  if (result.kind !== 'participant-b') throw new Error('unreachable')
  assert.equal(result.totalRounds, 5)
  assert.equal(result.self.placementLocked, false)
  assert.deepEqual(readParticipant(storage, MATCH_ID)?.role, 'B')
  assert.deepEqual(history.urls, [`/duel/${MATCH_ID}`])
}

/* 5: #p= none → LS fallback via claim bootstrap */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'A', PARTICIPANT_A_TOKEN)
  const history = new MemoryHistory()
  const coordinator = createDuelClaimBootstrapCoordinator({
    storage,
    history,
    fetch: async () => {
      assert.fail('fallback path must not fetch for participant A')
      return json({})
    },
    crypto: cryptoFixture,
  })
  const result = await coordinator.run(CLEAN_URL)
  assert.deepEqual(result, { kind: 'participant-a', matchId: MATCH_ID })
  assert.equal(history.urls.length, 0)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, PARTICIPANT_A_TOKEN)
}

/* 6: #invite= bootstrap — GET-first import when pi1 already authenticates */
{
  const storage = new MemoryStorage()
  const history = new MemoryHistory()
  const events: string[] = []
  const coordinator = createDuelClaimBootstrapCoordinator({
    storage,
    history,
    fetch: async (input) => {
      events.push(`fetch:${String(input)}`)
      if (String(input).endsWith('/claim')) {
        return json({
          matchId: MATCH_ID,
          totalRounds: 5,
          participant: { role: 'B', token: INVITATION_TOKEN },
          createdAt: CREATED_AT,
          claimedAt: '2026-01-01T00:01:00.000Z',
          expiresAt: null,
          formationVersion: 1,
          ruleVersion: 1,
        }, 201)
      }
      return json(getResponse('B', {
        self: { claimed: true, placementLocked: false },
        opponent: { claimed: true, placementLocked: true },
      }))
    },
    crypto: cryptoFixture,
  })
  const result = await coordinator.run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert(events.some((event) => event.endsWith(`/matches/${MATCH_ID}`)))
  assert(!events.some((event) => event.endsWith('/claim')))
  assert.equal(readParticipant(storage, MATCH_ID)?.role, 'B')
  assert.equal(readParticipant(storage, MATCH_ID)?.token, INVITATION_TOKEN)
  assert.deepEqual(history.urls, [`/duel/${MATCH_ID}`])
}

/* 7–8, 13: invalid / network — no LS write, no fragment clean */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', OTHER_B_TOKEN)
  const before = snapshotParticipant(storage)
  const history = new MemoryHistory()
  await expectCapabilityFailure(() =>
    importDuelParticipantCapability(A_URL, {
      storage,
      history,
      fetch: async () => json({ error: { code: 'match_unavailable' } }, 404),
    }),
  )
  assert.equal(snapshotParticipant(storage), before)
  assert.equal(history.urls.length, 0)

  const historyNet = new MemoryHistory()
  await expectCapabilityFailure(() =>
    importDuelParticipantCapability(A_URL, {
      storage,
      history: historyNet,
      fetch: async () => {
        throw new TypeError('network down')
      },
    }),
  )
  assert.equal(snapshotParticipant(storage), before)
  assert.equal(historyNet.urls.length, 0)
}

/* 9: matchId mismatch */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', OTHER_B_TOKEN)
  const before = snapshotParticipant(storage)
  const history = new MemoryHistory()
  await expectCapabilityFailure(() =>
    importDuelParticipantCapability(A_URL, {
      storage,
      history,
      fetch: async () => json(getResponse('A', { matchId: OTHER_MATCH_ID })),
    }),
  )
  assert.equal(snapshotParticipant(storage), before)
  assert.equal(history.urls.length, 0)
}

/* 10: role mismatch */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', OTHER_B_TOKEN)
  const before = snapshotParticipant(storage)
  const history = new MemoryHistory()
  await expectCapabilityFailure(() =>
    importDuelParticipantCapability(A_URL, {
      storage,
      history,
      fetch: async () => json(getResponse('B')),
    }),
  )
  assert.equal(snapshotParticipant(storage), before)
  assert.equal(history.urls.length, 0)
}

/* 11: existing B LS replaced only after valid A #p= auth */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', OTHER_B_TOKEN)
  const history = new MemoryHistory()
  const coordinator = createDuelClaimBootstrapCoordinator({
    storage,
    history,
    fetch: async (_input, init) => {
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${PARTICIPANT_A_TOKEN}`,
      )
      return json(getResponse('A'))
    },
    crypto: cryptoFixture,
  })
  const result = await coordinator.run(A_URL)
  assert.deepEqual(result, { kind: 'participant-a', matchId: MATCH_ID })
  assert.deepEqual(readParticipant(storage, MATCH_ID), {
    version: 1,
    matchId: MATCH_ID,
    role: 'A',
    token: PARTICIPANT_A_TOKEN,
  })
  assert.deepEqual(history.urls, [`/duel/${MATCH_ID}`])
}

/* 12: invalid A #p= keeps existing B */
{
  const storage = new MemoryStorage()
  setParticipant(storage, 'B', OTHER_B_TOKEN)
  const before = snapshotParticipant(storage)
  const history = new MemoryHistory()
  await expectBootstrapFailure(() =>
    createDuelClaimBootstrapCoordinator({
      storage,
      history,
      fetch: async () => json({ error: { code: 'match_unavailable' } }, 404),
      crypto: cryptoFixture,
    }).run(A_URL),
  )
  assert.equal(snapshotParticipant(storage), before)
  assert.equal(history.urls.length, 0)
}

/* 4 continued: stored participant usable as Bearer after import */
{
  const storage = new MemoryStorage()
  await importDuelParticipantCapability(B_URL, {
    storage,
    history: new MemoryHistory(),
    fetch: async () => json(getResponse('B')),
  })
  const stored = readParticipant(storage, MATCH_ID)
  assert(stored)
  let seenAuth: string | null = null
  const coordinator = createDuelClaimBootstrapCoordinator({
    storage,
    history: new MemoryHistory(),
    fetch: async (_input, init) => {
      seenAuth = new Headers(init?.headers).get('Authorization')
      return json(getResponse('B', {
        self: { claimed: true, placementLocked: true },
        opponent: { claimed: true, placementLocked: true },
      }))
    },
    crypto: cryptoFixture,
  })
  const result = await coordinator.run(CLEAN_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(seenAuth, `Bearer ${PARTICIPANT_B_TOKEN}`)
}

const capabilitySource = await readFile(
  'src/duel/duelParticipantCapability.ts',
  'utf8',
)
const claimSource = await readFile('src/duel/duelClaim.ts', 'utf8')
for (const source of [capabilitySource, claimSource]) {
  assert(!source.includes('console.'))
  assert(!source.includes('../server/'))
}
assert(claimSource.includes("fragmentKind === 'participant'"))
assert(claimSource.includes("fragmentKind !== 'invite'"))
assert(!new DuelParticipantCapabilityError().message.includes(PARTICIPANT_A_TOKEN))

console.log('verify-duel-participant-capability-client: all checks passed')
