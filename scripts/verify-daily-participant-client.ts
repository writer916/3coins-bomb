/** DAILY browser persistence, JOIN recovery, and API-client checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createDailyParticipantCoordinator,
  DailyParticipantClientError,
  fetchDailyParticipant,
  postDailyJoin,
} from '../src/daily/dailyParticipantClient.ts'
import {
  DAILY_PARTICIPANT_STORAGE_VERSION,
  DailyParticipantStorageError,
  createPendingDailyParticipant,
  dailyParticipantStorageKey,
  readDailyParticipant,
  saveDailyParticipant,
  validateDailyParticipantStorageRecord,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
} from '../src/daily/dailyParticipantStorage.ts'

class MemoryStorage implements DailyStorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const date1 = '2026-10-14'
const date2 = '2026-10-15'
const requestId = '11111111-1111-4111-8111-111111111111'
const participantId = '22222222-2222-4222-8222-222222222222'
const token = `3cb_dp1_${'A'.repeat(43)}`
const acceptedAt = '2026-10-14T01:02:03.000Z'
const cryptoSource = { randomUUID: () => requestId as `${string}-${string}-${string}-${string}-${string}` }

assert.equal(
  dailyParticipantStorageKey(date1),
  '3cb:daily:v1:participant:2026-10-14',
)
const pending = createPendingDailyParticipant(date1, 'Player', cryptoSource)
assert.deepEqual(pending, {
  version: DAILY_PARTICIPANT_STORAGE_VERSION,
  phase: 'pending-join',
  challengeDate: date1,
  joinRequestId: requestId,
  nickname: 'Player',
})

const storage = new MemoryStorage()
let pendingWasStoredBeforeFetch = false
let joinCalls = 0
const coordinator = createDailyParticipantCoordinator({
  storage,
  crypto: cryptoSource,
  now: () => new Date('2026-10-14T23:59:59.999Z'),
  fetch: async (input, init) => {
    joinCalls += 1
    assert.equal(input, '/api/daily/challenges/current/participants')
    assert.equal(init?.cache, 'no-store')
    const headers = init?.headers as Record<string, string> | undefined
    assert.equal(headers?.['Cache-Control'], 'no-store')
    const stored = readDailyParticipant(storage, date1)
    pendingWasStoredBeforeFetch = stored?.phase === 'pending-join'
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    assert.equal(body.joinRequestId, requestId)
    assert.equal(body.nickname, 'Player')
    return Response.json({
      challengeDate: date1,
      participantId,
      nickname: 'Player',
      token,
      acceptedAt,
    }, { headers: { 'Cache-Control': 'no-store' } })
  },
})
const first = await coordinator.run('Player')
assert.equal(pendingWasStoredBeforeFetch, true)
assert.equal(first.restored, false)
assert.equal(first.participant.token, token)
assert.equal(readDailyParticipant(storage, date1)?.phase, 'joined')
assert.equal(joinCalls, 1)

let getCalls = 0
const restoredCoordinator = createDailyParticipantCoordinator({
  storage,
  crypto: cryptoSource,
  now: () => new Date('2026-10-14T12:00:00.000Z'),
  fetch: async (input, init) => {
    getCalls += 1
    assert.equal(input, `/api/daily/challenges/${date1}/participant`)
    const headers = init?.headers as Record<string, string> | undefined
    assert.equal(headers?.Authorization, `Bearer ${token}`)
    assert.equal(String(input).includes(token), false)
    assert.equal(String(input).includes(requestId), false)
    return Response.json({
      challengeDate: date1,
      participantId,
      nickname: 'Player',
      acceptedAt,
      completedAt: null,
      expiredAt: null,
    })
  },
})
const restored = await restoredCoordinator.run('Ignored')
assert.equal(restored.restored, true)
assert.equal(getCalls, 1)
assert.equal(joinCalls, 1)

const retryStorage = new MemoryStorage()
let retryRequestId: string | null = null
const failing = createDailyParticipantCoordinator({
  storage: retryStorage,
  crypto: cryptoSource,
  now: () => new Date('2026-10-14T12:00:00.000Z'),
  fetch: async (_input, init) => {
    retryRequestId = (JSON.parse(String(init?.body)) as { joinRequestId: string }).joinRequestId
    throw new TypeError('offline')
  },
})
await assert.rejects(failing.run('Original'), (error: unknown) =>
  error instanceof DailyParticipantClientError && error.code === 'NETWORK_FAILURE')
const savedPending = readDailyParticipant(retryStorage, date1)
assert.equal(savedPending?.phase, 'pending-join')
assert.equal(savedPending?.joinRequestId, retryRequestId)
assert.equal(savedPending?.nickname, 'Original')

const retrying = createDailyParticipantCoordinator({
  storage: retryStorage,
  crypto: { randomUUID: () => { throw new Error('must not regenerate') } },
  now: () => new Date('2026-10-14T12:00:00.000Z'),
  fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    assert.equal(body.joinRequestId, requestId)
    assert.equal(body.nickname, 'Original')
    return Response.json({
      challengeDate: date1,
      participantId,
      nickname: 'Original',
      token,
      acceptedAt,
    })
  },
})
await retrying.run('Changed')

const authFailureStorage = new MemoryStorage()
saveDailyParticipant(authFailureStorage, first.participant)
let authFetches = 0
const authFailure = createDailyParticipantCoordinator({
  storage: authFailureStorage,
  crypto: cryptoSource,
  now: () => new Date('2026-10-14T12:00:00.000Z'),
  fetch: async () => {
    authFetches += 1
    return Response.json({ error: { code: 'unauthorized' } }, { status: 401 })
  },
})
await assert.rejects(authFailure.run('Changed'), (error: unknown) =>
  error instanceof DailyParticipantClientError &&
  error.code === 'AUTHENTICATION_FAILED')
assert.equal(authFetches, 1)
assert.equal(readDailyParticipant(authFailureStorage, date1)?.phase, 'joined')

const dateSwitchStorage = new MemoryStorage()
saveDailyParticipant(dateSwitchStorage, first.participant)
let newDateBody: Record<string, unknown> | null = null
const switched = createDailyParticipantCoordinator({
  storage: dateSwitchStorage,
  crypto: cryptoSource,
  now: () => new Date('2026-10-15T00:00:00.000Z'),
  fetch: async (_input, init) => {
    newDateBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({
      challengeDate: date2,
      participantId,
      nickname: 'Next',
      token,
      acceptedAt: '2026-10-15T00:00:01.000Z',
    })
  },
})
await switched.run('Next')
assert.equal(newDateBody?.nickname, 'Next')
assert.notEqual(dailyParticipantStorageKey(date1), dailyParticipantStorageKey(date2))
assert.equal(readDailyParticipant(dateSwitchStorage, date1)?.phase, 'joined')
assert.equal(readDailyParticipant(dateSwitchStorage, date2)?.phase, 'joined')

const joined = first.participant as JoinedDailyParticipantRecord
for (const status of [400, 401, 404, 409, 500, 503] as const) {
  const operation = status === 400 || status === 409 || status === 503
    ? postDailyJoin(pending, async () => Response.json({}, { status }))
    : fetchDailyParticipant(joined, async () => Response.json({}, { status }))
  const expected = status === 400
    ? 'INVALID_INPUT'
    : status === 401 || status === 404
      ? 'AUTHENTICATION_FAILED'
      : status === 409
        ? 'CHALLENGE_UNAVAILABLE'
        : 'TEMPORARY_FAILURE'
  await assert.rejects(operation, (error: unknown) =>
    error instanceof DailyParticipantClientError && error.code === expected)
}

const invalidInputStorage = new MemoryStorage()
await assert.rejects(
  createDailyParticipantCoordinator({
    storage: invalidInputStorage,
    crypto: cryptoSource,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async () => { throw new Error('must not fetch') },
  }).run('bad nickname'),
  (error: unknown) =>
    error instanceof DailyParticipantClientError && error.code === 'INVALID_INPUT',
)
assert.equal(readDailyParticipant(invalidInputStorage, date1), null)

await assert.rejects(
  postDailyJoin(pending, async () => new Response('{bad', { status: 200 })),
  (error: unknown) =>
    error instanceof DailyParticipantClientError && error.code === 'INVALID_RESPONSE',
)

const unavailable: DailyStorageAdapter = {
  getItem() { throw new Error('blocked') },
  setItem() { throw new Error('blocked') },
}
assert.throws(
  () => readDailyParticipant(unavailable, date1),
  (error: unknown) =>
    error instanceof DailyParticipantStorageError && error.code === 'READ_FAILED',
)
assert.throws(
  () => saveDailyParticipant(unavailable, pending),
  (error: unknown) =>
    error instanceof DailyParticipantStorageError && error.code === 'WRITE_FAILED',
)

const invalidStorage = new MemoryStorage()
invalidStorage.setItem(dailyParticipantStorageKey(date1), '{bad')
assert.throws(() => readDailyParticipant(invalidStorage, date1), DailyParticipantStorageError)
assert.throws(
  () => validateDailyParticipantStorageRecord({ ...pending, token }),
  DailyParticipantStorageError,
)

const root = resolve(import.meta.dirname, '..')
for (const file of [
  'src/daily/dailyParticipantStorage.ts',
  'src/daily/dailyParticipantClient.ts',
]) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /[?&](?:token|joinRequestId)=/)
}

console.log('verify:daily-participant-client OK')
