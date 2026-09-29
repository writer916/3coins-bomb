import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelInvitationUrl,
  DuelInvitationUrlError,
  parseDuelInvitationUrl,
  prepareDuelInvitationEntry,
  type HistoryAdapter,
} from '../src/duel/duelInvitation'
import {
  DUEL_MATCH_INDEX_KEY,
  DUEL_PENDING_CLAIM_KEY,
  completeParticipantBClaim,
  createPendingClaimRecord,
  invitationStorageKey,
  participantStorageKey,
  readMatchIndex,
  readParticipant,
  readPendingClaim,
  savePendingClaim,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH_ID = '22222222-2222-4222-8222-222222222222'
const INVITATION_TOKEN = `3cb_pi1_${'a'.repeat(42)}A`
const OTHER_INVITATION_TOKEN = `3cb_pi1_${'b'.repeat(42)}A`
const PARTICIPANT_A_TOKEN = `3cb_pa1_${'c'.repeat(42)}A`
const PARTICIPANT_B_TOKEN = `3cb_pb1_${'d'.repeat(42)}A`
const ORIGIN = 'https://example.test'
const EXPECTED_URL = `${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  readonly mutations: string[] = []
  failSetKey: string | null = null

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (key === this.failSetKey) throw new Error('simulated write failure')
    this.values.set(key, value)
    this.mutations.push(`set:${key}`)
  }

  removeItem(key: string): void {
    this.values.delete(key)
    this.mutations.push(`remove:${key}`)
  }
}

class MemoryHistory implements HistoryAdapter {
  readonly urls: string[] = []
  replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
    this.urls.push(String(url))
  }
}

const cryptoFixture = {
  calls: 0,
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    this.calls += 1
    if (array instanceof Uint8Array) array.fill(9)
    return array
  },
}

function setParticipant(
  storage: MemoryStorage,
  matchId: string,
  role: 'A' | 'B',
  token: string,
): void {
  storage.setItem(
    participantStorageKey(matchId),
    JSON.stringify({ version: 1, matchId, role, token }),
  )
}

function expectInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof Error)
    assert(!error.message.includes(INVITATION_TOKEN))
    assert(!error.message.includes(EXPECTED_URL))
    return true
  })
}

const generated = createDuelInvitationUrl(ORIGIN, MATCH_ID, INVITATION_TOKEN)
assert.equal(generated, EXPECTED_URL)
assert.equal(createDuelInvitationUrl(ORIGIN, MATCH_ID, INVITATION_TOKEN), generated)
const generatedUrl = new URL(generated)
assert.equal(generatedUrl.pathname, `/duel/${MATCH_ID}`)
assert.equal(generatedUrl.search, '')
assert.equal(generatedUrl.hash, `#invite=${INVITATION_TOKEN}`)
assert(!generated.includes(PARTICIPANT_A_TOKEN))
expectInvalid(() => createDuelInvitationUrl(`${ORIGIN}/path`, MATCH_ID, INVITATION_TOKEN))

assert.deepEqual(parseDuelInvitationUrl(EXPECTED_URL), {
  matchId: MATCH_ID,
  invitationToken: INVITATION_TOKEN,
  cleanPath: `/duel/${MATCH_ID}`,
})
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/other/${MATCH_ID}#invite=${INVITATION_TOKEN}`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/not-a-uuid#invite=${INVITATION_TOKEN}`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}#invite=bad`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}&extra=1`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}#invite=${INVITATION_TOKEN}&invite=${INVITATION_TOKEN}`))
expectInvalid(() => parseDuelInvitationUrl(`${ORIGIN}/duel/${MATCH_ID}?invite=${INVITATION_TOKEN}#invite=${INVITATION_TOKEN}`))

const pendingStorage = new MemoryStorage()
const pending = createPendingClaimRecord(MATCH_ID, INVITATION_TOKEN, cryptoFixture)
savePendingClaim(pendingStorage, pending)
assert.deepEqual(readPendingClaim(pendingStorage), pending)
assert.equal(pending.claimRecoverySecret.length, 43)
assert.match(pending.claimRecoverySecret, /^[A-Za-z0-9_-]{43}$/)
pendingStorage.setItem(DUEL_PENDING_CLAIM_KEY, '{broken')
expectInvalid(() => readPendingClaim(pendingStorage))

const newStorage = new MemoryStorage()
const newHistory = new MemoryHistory()
cryptoFixture.calls = 0
const newEntry = prepareDuelInvitationEntry(
  EXPECTED_URL,
  newStorage,
  newHistory,
  cryptoFixture,
)
assert.equal(newEntry.kind, 'new-claim')
assert.equal(cryptoFixture.calls, 1)
assert.equal(newHistory.urls[0], `/duel/${MATCH_ID}`)
assert(readPendingClaim(newStorage))

const retryHistory = new MemoryHistory()
const secretBeforeRetry = readPendingClaim(newStorage)!.claimRecoverySecret
const retryEntry = prepareDuelInvitationEntry(
  EXPECTED_URL,
  newStorage,
  retryHistory,
  cryptoFixture,
)
assert.equal(retryEntry.kind, 'claim-retry')
assert.equal(cryptoFixture.calls, 1)
assert.equal(readPendingClaim(newStorage)!.claimRecoverySecret, secretBeforeRetry)

const bStorage = new MemoryStorage()
setParticipant(bStorage, MATCH_ID, 'B', PARTICIPANT_B_TOKEN)
const bEntry = prepareDuelInvitationEntry(
  EXPECTED_URL,
  bStorage,
  new MemoryHistory(),
  cryptoFixture,
)
assert.equal(bEntry.kind, 'participant-b')
assert.equal(readPendingClaim(bStorage), null)

const aStorage = new MemoryStorage()
setParticipant(aStorage, MATCH_ID, 'A', PARTICIPANT_A_TOKEN)
const aEntry = prepareDuelInvitationEntry(
  EXPECTED_URL,
  aStorage,
  new MemoryHistory(),
  cryptoFixture,
)
assert.equal(aEntry.kind, 'participant-a')
assert.equal(readParticipant(aStorage, MATCH_ID)?.role, 'A')
assert.equal(readPendingClaim(aStorage), null)

const mismatchStorage = new MemoryStorage()
savePendingClaim(
  mismatchStorage,
  createPendingClaimRecord(OTHER_MATCH_ID, OTHER_INVITATION_TOKEN, cryptoFixture),
)
const mismatchHistory = new MemoryHistory()
expectInvalid(() =>
  prepareDuelInvitationEntry(
    EXPECTED_URL,
    mismatchStorage,
    mismatchHistory,
    cryptoFixture,
  ),
)
assert.equal(mismatchHistory.urls.length, 0)

const otherParticipantStorage = new MemoryStorage()
setParticipant(
  otherParticipantStorage,
  OTHER_MATCH_ID,
  'A',
  PARTICIPANT_A_TOKEN,
)
const unrelatedEntry = prepareDuelInvitationEntry(
  EXPECTED_URL,
  otherParticipantStorage,
  new MemoryHistory(),
  cryptoFixture,
)
assert.equal(unrelatedEntry.kind, 'new-claim')

const writeFailureStorage = new MemoryStorage()
writeFailureStorage.failSetKey = DUEL_PENDING_CLAIM_KEY
const writeFailureHistory = new MemoryHistory()
expectInvalid(() =>
  prepareDuelInvitationEntry(
    EXPECTED_URL,
    writeFailureStorage,
    writeFailureHistory,
    cryptoFixture,
  ),
)
assert.equal(writeFailureHistory.urls.length, 0)

const completionStorage = new MemoryStorage()
savePendingClaim(
  completionStorage,
  createPendingClaimRecord(MATCH_ID, INVITATION_TOKEN, cryptoFixture),
)
completionStorage.mutations.length = 0
completeParticipantBClaim(completionStorage, {
  matchId: MATCH_ID,
  participantToken: PARTICIPANT_B_TOKEN,
})
assert.deepEqual(completionStorage.mutations, [
  `set:${participantStorageKey(MATCH_ID)}`,
  `set:${DUEL_MATCH_INDEX_KEY}`,
  `remove:${DUEL_PENDING_CLAIM_KEY}`,
])
assert.equal(readParticipant(completionStorage, MATCH_ID)?.role, 'B')
assert(readMatchIndex(completionStorage).matchIds.includes(MATCH_ID))
assert.equal(readPendingClaim(completionStorage), null)

const partialStorage = new MemoryStorage()
savePendingClaim(
  partialStorage,
  createPendingClaimRecord(MATCH_ID, INVITATION_TOKEN, cryptoFixture),
)
partialStorage.failSetKey = DUEL_MATCH_INDEX_KEY
expectInvalid(() =>
  completeParticipantBClaim(partialStorage, {
    matchId: MATCH_ID,
    participantToken: PARTICIPANT_B_TOKEN,
  }),
)
assert(readPendingClaim(partialStorage))

const protectAStorage = new MemoryStorage()
savePendingClaim(
  protectAStorage,
  createPendingClaimRecord(MATCH_ID, INVITATION_TOKEN, cryptoFixture),
)
setParticipant(protectAStorage, MATCH_ID, 'A', PARTICIPANT_A_TOKEN)
expectInvalid(() =>
  completeParticipantBClaim(protectAStorage, {
    matchId: MATCH_ID,
    participantToken: PARTICIPANT_B_TOKEN,
  }),
)
assert.equal(readParticipant(protectAStorage, MATCH_ID)?.role, 'A')
assert(readPendingClaim(protectAStorage))

assert.equal(invitationStorageKey(MATCH_ID), `3cb:duel:v1:invitation:${MATCH_ID}`)
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'))
assert.deepEqual(vercel, {
  rewrites: [{ source: '/duel/:matchId', destination: '/index.html' }],
})
assert(!vercel.rewrites.some((rewrite: { source: string }) => rewrite.source.includes('api')))

const invitationSource = await readFile('src/duel/duelInvitation.ts', 'utf8')
const persistenceSource = await readFile('src/duel/duelPersistence.ts', 'utf8')
for (const source of [invitationSource, persistenceSource]) {
  assert(!source.includes('../server/'))
  assert(!source.includes('node:crypto'))
  assert(!source.includes('Math.random'))
  assert(!source.includes('console.'))
}
assert(!invitationSource.includes('participantToken: string'))
assert(!invitationSource.includes('authToken'))
assert(!new DuelInvitationUrlError().message.includes(INVITATION_TOKEN))

console.log('verify-duel-invitation: all checks passed')
