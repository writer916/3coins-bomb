/** Browser-side DUEL persistence and recovery checks. No secrets are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DUEL_MATCH_INDEX_KEY,
  DUEL_PENDING_CREATE_KEY,
  DUEL_PENDING_LOCK_KEY,
  DuelStorageError,
  completePendingLock,
  createPendingCreateRecord,
  generateCreateRecoverySecret,
  generateCreateRequestId,
  invitationStorageKey,
  participantStorageKey,
  persistCreatedMatchHandoff,
  readARecoveryState,
  readInvitation,
  readMatchIndex,
  readParticipant,
  readPendingCreate,
  readPendingLock,
  savePendingCreate,
  toCanonicalDuelPlacements,
  validateInvitation,
  validateMatchIndex,
  validateParticipant,
  validatePendingCreate,
  validatePendingLock,
  type StorageAdapter,
} from '../src/duel/duelPersistence.ts'
import type { DuelRoundPlacement } from '../src/game/duelPlacement.ts'

const root = resolve(import.meta.dirname, '..')
const matchId = '550e8400-e29b-41d4-a716-446655440000'
const participantToken = `3cb_pa1_${'A'.repeat(43)}`
const invitationToken = `3cb_pi1_${'B'.repeat(42)}Q`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  failRead = false
  failWrite = false
  failRemove = false
  ignoreWrite = false
  ignoreRemove = false

  getItem(key: string): string | null {
    if (this.failRead) throw new Error('sensitive read failure')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error(`sensitive write failure ${value}`)
    if (!this.ignoreWrite) this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error(`sensitive remove failure ${key}`)
    if (!this.ignoreRemove) this.values.delete(key)
  }
}

function expectStorageCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof DuelStorageError)
    assert.equal(error.code, code)
    assert(!error.message.includes(participantToken))
    assert(!error.message.includes(invitationToken))
    assert(!error.message.includes('bag-'))
    return true
  })
}

const domainPlacements: DuelRoundPlacement[] = [
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagId: 'bag-2',
    coinCountsByBag: { 'bag-1': 2, 'bag-3': 1 },
  },
  {
    roundNumber: 2,
    bagCount: 5,
    bombBagId: 'bag-4',
    coinCountsByBag: { 'bag-5': 1, 'bag-1': 2 },
  },
]

const canonical = toCanonicalDuelPlacements(domainPlacements, 2)
assert.deepEqual(canonical, [
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagNumber: 2,
    coinBagNumbers: [1, 1, 3],
  },
  {
    roundNumber: 2,
    bagCount: 5,
    bombBagNumber: 4,
    coinBagNumbers: [1, 1, 5],
  },
])
expectStorageCode(
  () => toCanonicalDuelPlacements(domainPlacements.slice(0, 1), 2),
  'INVALID_DATA',
)
expectStorageCode(
  () =>
    toCanonicalDuelPlacements(
      [{ ...domainPlacements[0], coinCountsByBag: { 'bag-1': 2 } }],
      1,
    ),
  'INVALID_DATA',
)

const generatedRequestId = generateCreateRequestId()
assert.match(
  generatedRequestId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
)
const generatedRecoverySecret = generateCreateRecoverySecret()
assert.match(generatedRecoverySecret, /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)

const pendingCreate = createPendingCreateRecord(domainPlacements, 2)
const storage = new MemoryStorage()
savePendingCreate(storage, pendingCreate)
assert.deepEqual(readPendingCreate(storage), pendingCreate)
assert.equal(readARecoveryState(storage).phase, 'create-retry')

const pendingLock = persistCreatedMatchHandoff(storage, {
  matchId,
  participantToken,
  invitationToken,
})
assert.equal(readPendingCreate(storage), null)
assert.deepEqual(readPendingLock(storage), pendingLock)
assert.deepEqual(readParticipant(storage, matchId), {
  version: 1,
  matchId,
  role: 'A',
  token: participantToken,
})
assert.deepEqual(readInvitation(storage, matchId), {
  version: 1,
  matchId,
  token: invitationToken,
})
const lockRecovery = readARecoveryState(storage)
assert.equal(lockRecovery.phase, 'lock-retry')
if (lockRecovery.phase === 'lock-retry') {
  assert.equal(lockRecovery.pending.matchId, matchId)
  assert.equal(lockRecovery.participant.token, participantToken)
  assert.deepEqual(lockRecovery.pending.placements, canonical)
}

const index = completePendingLock(storage, matchId)
assert.deepEqual(index, { version: 1, matchIds: [matchId] })
assert.deepEqual(readMatchIndex(storage), index)
assert.equal(readPendingLock(storage), null)
assert.equal(readARecoveryState(storage).phase, 'idle')

// Completion is retry-safe when pending-lock is recreated after response loss.
storage.values.set(
  DUEL_PENDING_LOCK_KEY,
  JSON.stringify({
    version: 1,
    phase: 'pending-lock',
    matchId,
    placements: canonical,
  }),
)
assert.deepEqual(completePendingLock(storage, matchId), index)

const records = [
  [
    validatePendingCreate,
    {
      ...pendingCreate,
      version: 2,
    },
  ],
  [
    validatePendingCreate,
    {
      ...pendingCreate,
      phase: 'wrong',
    },
  ],
  [
    validatePendingLock,
    {
      version: 1,
      phase: 'pending-lock',
      matchId,
      placements: [{ ...canonical[0], coinBagNumbers: [1, 2, 3] }],
    },
  ],
  [
    validateParticipant,
    { version: 1, matchId, role: 'A', token: invitationToken },
  ],
  [
    validateInvitation,
    { version: 1, matchId, token: participantToken },
  ],
  [validateMatchIndex, { version: 1, matchIds: [matchId, matchId] }],
] as const
for (const [validate, value] of records) {
  expectStorageCode(() => validate(value), 'INVALID_DATA')
}

const corrupted = new MemoryStorage()
corrupted.values.set(DUEL_PENDING_CREATE_KEY, '{')
expectStorageCode(() => readPendingCreate(corrupted), 'INVALID_DATA')
corrupted.values.set(DUEL_PENDING_CREATE_KEY, JSON.stringify({ ...pendingCreate, version: 2 }))
expectStorageCode(() => readPendingCreate(corrupted), 'INVALID_DATA')

const writeFailure = new MemoryStorage()
writeFailure.failWrite = true
expectStorageCode(() => savePendingCreate(writeFailure, pendingCreate), 'WRITE_FAILED')
assert.equal(writeFailure.values.size, 0)
const silentWriteFailure = new MemoryStorage()
silentWriteFailure.ignoreWrite = true
expectStorageCode(
  () => savePendingCreate(silentWriteFailure, pendingCreate),
  'WRITE_FAILED',
)

const handoffFailure = new MemoryStorage()
savePendingCreate(handoffFailure, pendingCreate)
let writes = 0
const failDuringHandoff: StorageAdapter = {
  getItem: (key) => handoffFailure.getItem(key),
  setItem: (key, value) => {
    writes += 1
    if (writes === 2) throw new Error(`sensitive ${value}`)
    handoffFailure.setItem(key, value)
  },
  removeItem: (key) => handoffFailure.removeItem(key),
}
expectStorageCode(
  () =>
    persistCreatedMatchHandoff(failDuringHandoff, {
      matchId,
      participantToken,
      invitationToken,
    }),
  'WRITE_FAILED',
)
assert.deepEqual(readPendingCreate(handoffFailure), pendingCreate)
assert.equal(readPendingLock(handoffFailure), null)

const removeFailure = new MemoryStorage()
savePendingCreate(removeFailure, pendingCreate)
removeFailure.failRemove = true
expectStorageCode(
  () =>
    persistCreatedMatchHandoff(removeFailure, {
      matchId,
      participantToken,
      invitationToken,
    }),
  'REMOVE_FAILED',
)
assert(readPendingCreate(removeFailure))
assert(readPendingLock(removeFailure))
assert.equal(readARecoveryState(removeFailure).phase, 'lock-retry')

const silentRemoveFailure = new MemoryStorage()
savePendingCreate(silentRemoveFailure, pendingCreate)
silentRemoveFailure.ignoreRemove = true
expectStorageCode(
  () =>
    persistCreatedMatchHandoff(silentRemoveFailure, {
      matchId,
      participantToken,
      invitationToken,
    }),
  'REMOVE_FAILED',
)

const readFailure = new MemoryStorage()
readFailure.failRead = true
expectStorageCode(() => readPendingCreate(readFailure), 'READ_FAILED')

assert.equal(participantStorageKey(matchId), `3cb:duel:v1:participant:${matchId}`)
assert.equal(invitationStorageKey(matchId), `3cb:duel:v1:invitation:${matchId}`)
assert.equal(DUEL_PENDING_CREATE_KEY, '3cb:duel:v1:pending-create')
assert.equal(DUEL_PENDING_LOCK_KEY, '3cb:duel:v1:pending-lock')
assert.equal(DUEL_MATCH_INDEX_KEY, '3cb:duel:v1:index')

const source = readFileSync(resolve(root, 'src/duel/duelPersistence.ts'), 'utf8')
assert(!source.includes('Math.random'))
assert(!source.includes("from '../../server"))
assert(!source.includes("from '../server"))
assert(!source.includes('node:crypto'))
assert(!source.includes('console.'))

console.log('verify:duel-persistence OK')
