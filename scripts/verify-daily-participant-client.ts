/** DAILY browser persistence, JOIN recovery, multi-tab locks, and API-client checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createDailyParticipantCoordinator,
  DailyParticipantClientError,
  fetchDailyParticipant,
  postDailyJoin,
  type DailyJoinLockManager,
} from '../src/daily/dailyParticipantClient.ts'
import {
  DAILY_PARTICIPANT_STORAGE_VERSION,
  DailyParticipantStorageError,
  createPendingDailyParticipant,
  dailyJoinLockName,
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

/** Serializes same-named locks; models Web Locks across "tabs" in one process. */
class SerialLockManager implements DailyJoinLockManager {
  private readonly tails = new Map<string, Promise<void>>()
  active = new Set<string>()
  requestCount = 0
  releases = 0

  request<T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T> {
    this.requestCount += 1
    const previous = this.tails.get(name) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    this.tails.set(
      name,
      previous.then(() => gate, () => gate),
    )
    return previous.then(async () => {
      assert.equal(this.active.has(name), false, 'lock must be exclusive')
      this.active.add(name)
      try {
        return await callback({ name })
      } finally {
        this.active.delete(name)
        this.releases += 1
        release()
      }
    })
  }
}

const date1 = '2026-10-14'
const date2 = '2026-10-15'
const requestId = '11111111-1111-4111-8111-111111111111'
const requestIdB = '33333333-3333-4333-8333-333333333333'
const participantId = '22222222-2222-4222-8222-222222222222'
const token = `3cb_dp1_${'A'.repeat(43)}`
const acceptedAt = '2026-10-14T01:02:03.000Z'
const cryptoSource = {
  randomUUID: () => requestId as `${string}-${string}-${string}-${string}-${string}`,
}

assert.equal(
  dailyParticipantStorageKey(date1),
  '3cb:daily:v1:participant:2026-10-14',
)
assert.equal(dailyJoinLockName(date1), '3cb:daily:v1:join-lock:2026-10-14')
assert.notEqual(dailyJoinLockName(date1), dailyJoinLockName(date2))

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
  locks: null,
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
  locks: null,
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
  locks: null,
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
  locks: null,
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
  locks: null,
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
  locks: null,
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
    locks: null,
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

// --- Web Locks: concurrent same-day JOIN across two coordinators ("tabs") ---
{
  const shared = new MemoryStorage()
  const locks = new SerialLockManager()
  let uuidCalls = 0
  const ids = [requestId, requestIdB] as const
  const cryptoMulti = {
    randomUUID: () => {
      const id = ids[uuidCalls] ?? requestIdB
      uuidCalls += 1
      return id as `${string}-${string}-${string}-${string}-${string}`
    },
  }
  let joinBodies: string[] = []
  let getCount = 0
  let joinHold!: () => void
  const joinGate = new Promise<void>((resolveGate) => {
    joinHold = resolveGate
  })
  const fetchShared: typeof fetch = async (input, init) => {
    if (String(input).includes('/participants') && init?.method === 'POST') {
      const body = String(init.body)
      joinBodies.push(body)
      await joinGate
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Alpha',
        token,
        acceptedAt,
      })
    }
    getCount += 1
    return Response.json({
      challengeDate: date1,
      participantId,
      nickname: 'Alpha',
      acceptedAt,
      completedAt: null,
      expiredAt: null,
    })
  }
  const tabA = createDailyParticipantCoordinator({
    storage: shared,
    crypto: cryptoMulti,
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: fetchShared,
  })
  const tabB = createDailyParticipantCoordinator({
    storage: shared,
    crypto: cryptoMulti,
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: fetchShared,
  })
  const started = Promise.all([tabA.run('Alpha'), tabB.run('Beta')])
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
  assert.equal(joinBodies.length, 1, 'second tab must wait on lock before JOIN')
  joinHold()
  const [resultA, resultB] = await started
  assert.equal(joinBodies.length, 1, 'JOIN API must not duplicate under locks')
  assert.equal(resultA.participant.participantId, participantId)
  assert.equal(resultB.participant.participantId, participantId)
  assert.equal(resultA.participant.token, token)
  assert.equal(resultB.participant.token, token)
  assert.equal(
    JSON.parse(joinBodies[0]!).joinRequestId,
    requestId,
  )
  assert.equal(
    resultA.restored || resultB.restored,
    true,
    'follower tab restores via GET',
  )
  assert.equal(getCount, 1)
  assert.equal(locks.releases, locks.requestCount)
}

// --- Web Locks: leader network failure leaves pending; follower retries same id ---
{
  const shared = new MemoryStorage()
  const locks = new SerialLockManager()
  let attempts = 0
  const tabFail = createDailyParticipantCoordinator({
    storage: shared,
    crypto: cryptoSource,
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async () => {
      attempts += 1
      throw new TypeError('offline')
    },
  })
  await assert.rejects(tabFail.run('Same'), (error: unknown) =>
    error instanceof DailyParticipantClientError && error.code === 'NETWORK_FAILURE')
  assert.equal(readDailyParticipant(shared, date1)?.phase, 'pending-join')
  assert.equal(readDailyParticipant(shared, date1)?.joinRequestId, requestId)

  const tabRetry = createDailyParticipantCoordinator({
    storage: shared,
    crypto: {
      randomUUID: () => {
        throw new Error('must reuse pending request id')
      },
    },
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async (_input, init) => {
      attempts += 1
      const body = JSON.parse(String(init?.body)) as { joinRequestId: string }
      assert.equal(body.joinRequestId, requestId)
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Same',
        token,
        acceptedAt,
      })
    },
  })
  const recovered = await tabRetry.run('Ignored')
  assert.equal(recovered.participant.joinRequestId, requestId)
  assert.equal(attempts, 2)
}

// --- Web Locks: callback exception still releases ---
{
  const locks = new SerialLockManager()
  const boomStorage = new MemoryStorage()
  const boom = createDailyParticipantCoordinator({
    storage: boomStorage,
    crypto: cryptoSource,
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async () => {
      throw new TypeError('boom')
    },
  })
  await assert.rejects(boom.run('X'), DailyParticipantClientError)
  assert.equal(locks.active.size, 0)
  assert.equal(locks.releases, 1)

  const ok = createDailyParticipantCoordinator({
    storage: new MemoryStorage(),
    crypto: cryptoSource,
    locks,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async () => Response.json({
      challengeDate: date1,
      participantId,
      nickname: 'Y',
      token,
      acceptedAt,
    }),
  })
  await ok.run('Y')
  assert.equal(locks.releases, 2)
}

// --- Web Locks: UTC date boundary while waiting for lock ---
{
  const shared = new MemoryStorage()
  const locks = new SerialLockManager()
  let clock = new Date('2026-10-14T23:59:59.000Z')
  const joinDates: string[] = []
  let releaseLeader!: () => void
  const leaderGate = new Promise<void>((resolveGate) => {
    releaseLeader = resolveGate
  })

  const leader = createDailyParticipantCoordinator({
    storage: shared,
    crypto: cryptoSource,
    locks,
    now: () => clock,
    fetch: async (_input, init) => {
      joinDates.push(
        (JSON.parse(String(init?.body)) as { nickname: string }).nickname,
      )
      await leaderGate
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'DayOne',
        token,
        acceptedAt,
      })
    },
  })
  const follower = createDailyParticipantCoordinator({
    storage: shared,
    crypto: {
      randomUUID: () =>
        requestIdB as `${string}-${string}-${string}-${string}-${string}`,
    },
    locks,
    now: () => clock,
    fetch: async (input, init) => {
      if (String(input).includes('/participants') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          nickname: string
          joinRequestId: string
        }
        joinDates.push(body.nickname)
        assert.equal(body.joinRequestId, requestIdB)
        assert.notEqual(body.joinRequestId, requestId)
        return Response.json({
          challengeDate: date2,
          participantId: '44444444-4444-4444-8444-444444444444',
          nickname: 'DayTwo',
          token: `3cb_dp1_${'C'.repeat(42)}A`,
          acceptedAt: '2026-10-15T00:00:01.000Z',
        })
      }
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'DayOne',
        acceptedAt,
        completedAt: null,
        expiredAt: null,
      })
    },
  })

  const leaderRun = leader.run('DayOne')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
  const followerRun = follower.run('DayTwo')
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
  clock = new Date('2026-10-15T00:00:00.000Z')
  releaseLeader()
  const [leaderResult, followerResult] = await Promise.all([leaderRun, followerRun])
  assert.equal(leaderResult.participant.challengeDate, date1)
  assert.equal(followerResult.participant.challengeDate, date2)
  assert.equal(readDailyParticipant(shared, date1)?.phase, 'joined')
  assert.equal(readDailyParticipant(shared, date2)?.phase, 'joined')
  assert.equal(
    joinDates.includes('DayTwo'),
    true,
    'new UTC day must JOIN under the new date, not reuse day-one pending',
  )
}

// --- No Web Locks: normal JOIN + prefer existing pending/joined before JOIN ---
{
  const noLockStorage = new MemoryStorage()
  let bodies: unknown[] = []
  const noLockJoin = createDailyParticipantCoordinator({
    storage: noLockStorage,
    crypto: cryptoSource,
    locks: null,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Solo',
        token,
        acceptedAt,
      })
    },
  })
  await noLockJoin.run('Solo')
  assert.equal(bodies.length, 1)

  const pendingPref = new MemoryStorage()
  saveDailyParticipant(pendingPref, {
    version: 1,
    phase: 'pending-join',
    challengeDate: date1,
    joinRequestId: requestIdB,
    nickname: 'Kept',
  })
  let usedId: string | null = null
  await createDailyParticipantCoordinator({
    storage: pendingPref,
    crypto: {
      randomUUID: () => {
        throw new Error('must prefer stored pending')
      },
    },
    locks: null,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async (_input, init) => {
      usedId = (JSON.parse(String(init?.body)) as { joinRequestId: string }).joinRequestId
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Kept',
        token,
        acceptedAt,
      })
    },
  }).run('Other')
  assert.equal(usedId, requestIdB)

  const joinedPref = new MemoryStorage()
  saveDailyParticipant(joinedPref, first.participant)
  let methods: string[] = []
  const joinedResult = await createDailyParticipantCoordinator({
    storage: joinedPref,
    crypto: cryptoSource,
    locks: null,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async (input, init) => {
      methods.push(String(init?.method ?? 'GET'))
      assert.equal(String(input).includes('/participant'), true)
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Player',
        acceptedAt,
        completedAt: null,
        expiredAt: null,
      })
    },
  }).run('Other')
  assert.equal(joinedResult.restored, true)
  assert.deepEqual(methods, ['GET'])
}

// --- No Web Locks: re-check storage written by another tab just before JOIN ---
{
  const shared = new MemoryStorage()
  let awaitingWriteVerify = false
  const joinedJson = JSON.stringify({
    version: 1,
    phase: 'joined',
    challengeDate: date1,
    joinRequestId: requestIdB,
    participantId,
    nickname: 'Winner',
    token,
    acceptedAt,
  })
  const racing = createDailyParticipantCoordinator({
    storage: {
      getItem(key) {
        if (awaitingWriteVerify) {
          awaitingWriteVerify = false
          return shared.getItem(key)
        }
        const current = shared.getItem(key)
        if (
          key === dailyParticipantStorageKey(date1) &&
          current &&
          (JSON.parse(current) as { phase?: string }).phase === 'pending-join'
        ) {
          // Another tab completed JOIN after our pending save / verify read.
          shared.setItem(key, joinedJson)
          return joinedJson
        }
        return current
      },
      setItem(key, value) {
        shared.setItem(key, value)
        awaitingWriteVerify = true
      },
    },
    crypto: cryptoSource,
    locks: null,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    fetch: async (input, init) => {
      assert.notEqual(init?.method, 'POST', 'must not JOIN after detecting joined')
      assert.equal(String(input).includes('/participant'), true)
      return Response.json({
        challengeDate: date1,
        participantId,
        nickname: 'Winner',
        acceptedAt,
        completedAt: null,
        expiredAt: null,
      })
    },
  })
  const raced = await racing.run('Loser')
  assert.equal(raced.restored, true)
  assert.equal(raced.participant.nickname, 'Winner')
}

const root = resolve(import.meta.dirname, '..')
for (const file of [
  'src/daily/dailyParticipantStorage.ts',
  'src/daily/dailyParticipantClient.ts',
]) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /[?&](?:token|joinRequestId)=/)
  assert.doesNotMatch(source, /fingerprint|BroadcastChannel|spin.?lock/i)
}
assert.match(
  readFileSync(resolve(root, 'src/daily/dailyParticipantClient.ts'), 'utf8'),
  /dailyJoinLockName/,
)
assert.match(
  readFileSync(resolve(root, 'src/daily/dailyParticipantStorage.ts'), 'utf8'),
  /3cb:daily:v1:join-lock:/,
)

console.log('verify:daily-participant-client OK')
