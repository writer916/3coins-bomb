/** DAILY play GET/start API checks (mock + optional Neon dev). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import dailyApi from '../api/daily.ts'
import { createDailyPlayHandler } from '../api/_daily/challenges/[date]/play.ts'
import { createDailyRoundStartHandler } from '../api/_daily/challenges/[date]/rounds/start.ts'
import {
  beginDailyRound,
  readDailyPlay,
  toDailyPlayResponse,
  validateDailyPlayAuth,
  validateDailyPlayCommand,
  DailyPlayApiError,
} from '../server/daily/playApi.ts'
import type {
  PersistedDailyPlayState,
  StartDailyRoundResult,
} from '../server/db/dailyPlay.ts'
import { deriveDailyParticipantCapability } from '../server/auth/dailyTokens.ts'
import { hashDailyParticipantCapability } from '../server/auth/dailyTokens.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2026-10-14'
const otherDate = '2026-10-15'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const joinRequestId = randomUUID()
const token = deriveDailyParticipantCapability(date, joinRequestId, environment)
const otherToken = deriveDailyParticipantCapability(
  otherDate,
  randomUUID(),
  environment,
)
const authHash = hashDailyParticipantCapability(token)

const baseState: PersistedDailyPlayState = {
  challengeDate: date,
  serverNow: '2026-10-14T12:00:00.000Z',
  challengeEndsAt: '2026-10-15T00:00:00.000Z',
  participantId: '11111111-1111-4111-8111-111111111111',
  displayNickname: 'Player',
  completedAt: null,
  expiredAt: null,
  completedRounds: 0,
  nextRoundNumber: 1,
  activeAttempt: null,
}

const activeState: PersistedDailyPlayState = {
  ...baseState,
  nextRoundNumber: 1,
  activeAttempt: {
    roundNumber: 1,
    startedAt: '2026-10-14T12:00:00.000Z',
    deadlineAt: '2026-10-14T12:01:00.000Z',
    openedBagCount: 0,
    bagCount: 5,
    opens: [],
  },
}

assert.deepEqual(Object.keys(toDailyPlayResponse(activeState)).sort(), [
  'activeAttempt',
  'challengeDate',
  'challengeEndsAt',
  'completedAt',
  'completedRounds',
  'expiredAt',
  'nextRoundNumber',
  'serverNow',
].sort())
assert.doesNotMatch(JSON.stringify(toDailyPlayResponse(activeState)), /bomb/i)
assert.doesNotMatch(JSON.stringify(toDailyPlayResponse(activeState)), /coinBag/i)
assert.doesNotMatch(
  JSON.stringify(toDailyPlayResponse(activeState)),
  /participantId|displayNickname|token/,
)

assert.throws(
  () => validateDailyPlayAuth('bad', `Bearer ${token}`),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () => validateDailyPlayAuth(date, null),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'UNAUTHORIZED',
)
// Wrong-day token still parses as capability; date×hash mismatch is NOT_FOUND on read.
assert.equal(
  validateDailyPlayAuth(date, `Bearer ${otherToken}`).challengeDate,
  date,
)

assert.throws(
  () => validateDailyPlayCommand(date, `Bearer ${token}`, null),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () => validateDailyPlayCommand(date, `Bearer ${token}`, 'not-a-uuid'),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'INVALID_REQUEST',
)

const getHandler = createDailyPlayHandler(async () =>
  toDailyPlayResponse(activeState),
)
const getOk = await getHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/play`, {
    headers: { Authorization: `Bearer ${token}` },
  }),
)
assert.equal(getOk.status, 200)
assert.equal(getOk.headers.get('cache-control'), 'no-store')
const getBody = (await getOk.json()) as Record<string, unknown>
assert.equal(getBody.challengeDate, date)
assert.ok(getBody.activeAttempt)

assert.equal(
  (
    await getHandler(
      new Request(`https://example.test/api/daily/challenges/${date}/play`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
  ).status,
  405,
)
assert.equal(
  (
    await getHandler(
      new Request(`https://example.test/api/daily/challenges/${date}/play`),
    )
  ).status,
  401,
)

const missing = createDailyPlayHandler(async () => {
  throw new DailyPlayApiError('NOT_FOUND')
})
assert.equal(
  (
    await missing(
      new Request(`https://example.test/api/daily/challenges/${date}/play`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
  ).status,
  404,
)

let startCalls = 0
let lastStartId: string | null = null
const startHandler = createDailyRoundStartHandler(async (command) => {
  startCalls += 1
  lastStartId = command.startRequestId
  if (command.startRequestId === '22222222-2222-4222-8222-222222222222') {
    throw new DailyPlayApiError('ALREADY_ACTIVE')
  }
  return toDailyPlayResponse(activeState)
})

const startKey = randomUUID()
const started = await startHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/rounds/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': startKey,
    },
  }),
)
assert.equal(started.status, 200)
assert.equal(started.headers.get('cache-control'), 'no-store')
assert.equal(lastStartId, startKey)
assert.equal(startCalls, 1)

assert.equal(
  (
    await startHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/start`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    )
  ).status,
  400,
)
assert.equal(
  (
    await startHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/start`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Idempotency-Key': 'bad',
          },
        },
      ),
    )
  ).status,
  400,
)
assert.equal(
  (
    await startHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/start`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': randomUUID(),
          },
        },
      ),
    )
  ).status,
  401,
)
const conflict = await startHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/rounds/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
    },
  }),
)
assert.equal(conflict.status, 409)
assert.equal(
  ((await conflict.json()) as { error: { code: string } }).error.code,
  'already_active',
)

// beginDailyRound maps DB reject reasons.
await assert.rejects(
  beginDailyRound(
    {
      challengeDate: date,
      authTokenHash: authHash,
      startRequestId: randomUUID(),
    },
    {
      start: async (): Promise<StartDailyRoundResult> => ({
        status: 'rejected',
        reason: 'challenge_ended',
        state: null,
      }),
    },
  ),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'CHALLENGE_ENDED',
)

const replayed = await beginDailyRound(
  {
    challengeDate: date,
    authTokenHash: authHash,
    startRequestId: randomUUID(),
  },
  {
    start: async (): Promise<StartDailyRoundResult> => ({
      status: 'replayed',
      state: activeState,
    }),
  },
)
assert.equal(replayed.activeAttempt?.roundNumber, 1)

const readOk = await readDailyPlay(
  { challengeDate: date, authTokenHash: authHash },
  { getState: async () => activeState },
)
assert.equal(readOk.completedRounds, 0)

await assert.rejects(
  readDailyPlay(
    { challengeDate: date, authTokenHash: authHash },
    { getState: async () => null },
  ),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'NOT_FOUND',
)

// Router wiring + JOIN untouched.
const routedPlay = await dailyApi.fetch(
  new Request(`https://example.test/api/daily/challenges/${date}/play`, {
    headers: { Authorization: `Bearer ${token}` },
  }),
)
// Real handler hits DB — may 503/404 without DATABASE_URL; only assert route exists.
assert.notEqual(
  (await routedPlay.json() as { error?: { code?: string } }).error?.code,
  'not_found',
)

const joinRoute = await dailyApi.fetch(
  new Request('https://example.test/api/daily/challenges/current/participants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'X', joinRequestId: randomUUID() }),
  }),
)
assert.notEqual(
  (await joinRoute.json() as { error?: { code?: string } }).error?.code,
  'not_found',
)

const dailyRouter = readFileSync(resolve(root, 'api/daily.ts'), 'utf8')
assert.match(dailyRouter, /rounds\/start/)
assert.match(dailyRouter, /\/play/)
assert.match(
  readFileSync(resolve(root, 'api/_daily/challenges/current/participants.ts'), 'utf8'),
  /createDailyJoinHandler/,
)
for (const file of [
  'server/daily/playApi.ts',
  'api/_daily/challenges/[date]/play.ts',
  'api/_daily/challenges/[date]/rounds/start.ts',
]) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /bomb_bag_number|bombBagNumber|coinBagNumbers/)
}

function loadNeonDevUrl(): string | null {
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv?.includes('ep-still-night-b339xjc9-pooler')) return fromEnv
  try {
    const raw = readFileSync(resolve(root, '.env.neon.dev.local'), 'utf8').trim()
    const match = /^DATABASE_URL=(.+)$/m.exec(raw)
    const url = match?.[1]?.trim()
    if (url?.includes('ep-still-night-b339xjc9-pooler')) return url
  } catch {
    /* optional */
  }
  return null
}

const neonUrl = loadNeonDevUrl()
if (!neonUrl) {
  console.log('verify:daily-play-api OK (handlers; Neon skipped)')
  process.exit(0)
}
if (neonUrl.includes('ep-ancient-lake')) {
  throw new Error('Refusing production Neon endpoint.')
}
process.env.DATABASE_URL = neonUrl

const { sql } = await import('drizzle-orm')
const { getDatabase } = await import('../server/db/client.ts')
const { persistOrLoadDailyQuestionSet } = await import(
  '../server/db/dailyQuestionSet.ts'
)
const { provideDailyQuestionRounds } = await import(
  '../server/daily/provideDailyQuestionSet.ts'
)
const { createDailyPlayHandler: livePlay } = await import(
  '../api/_daily/challenges/[date]/play.ts'
)
const { createDailyRoundStartHandler: liveStart } = await import(
  '../api/_daily/challenges/[date]/rounds/start.ts'
)

const liveDate = '2099-08-01'
const liveJoin = randomUUID()
const liveToken = deriveDailyParticipantCapability(
  liveDate,
  liveJoin,
  environment,
)
const liveHash = hashDailyParticipantCapability(liveToken)
const orderSql = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => index + 1).join(',')}]::smallint[]`,
)

async function cleanup() {
  await getDatabase().execute(sql`
    delete from daily_challenges where challenge_date = ${liveDate}::date
  `)
}

await cleanup()
await persistOrLoadDailyQuestionSet({
  challengeDate: liveDate,
  rounds: provideDailyQuestionRounds(),
})
await getDatabase().execute(sql`
  insert into daily_challenge_participants (
    challenge_date, display_nickname, nickname_key, auth_token_hash,
    join_request_id, question_order
  ) values (
    ${liveDate}::date, 'ApiPlay', 'apiplay', ${liveHash},
    ${liveJoin}::uuid, ${orderSql}
  )
`)

const liveGet = livePlay()
const livePost = liveStart()
const before = await liveGet(
  new Request(`https://example.test/api/daily/challenges/${liveDate}/play`, {
    headers: { Authorization: `Bearer ${liveToken}` },
  }),
)
assert.equal(before.status, 200)
const beforeBody = (await before.json()) as {
  activeAttempt: null | object
  completedRounds: number
}
assert.equal(beforeBody.activeAttempt, null)
assert.equal(beforeBody.completedRounds, 0)

const keyA = randomUUID()
const round1 = await livePost(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/start`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${liveToken}`,
        'Idempotency-Key': keyA,
      },
    },
  ),
)
assert.equal(round1.status, 200)
const round1Body = (await round1.json()) as {
  activeAttempt: { roundNumber: number; bagCount: number }
}
assert.equal(round1Body.activeAttempt.roundNumber, 1)
assert.ok(round1Body.activeAttempt.bagCount >= 3)

const replayHttp = await livePost(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/start`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${liveToken}`,
        'Idempotency-Key': keyA,
      },
    },
  ),
)
assert.equal(replayHttp.status, 200)

const otherKey = await livePost(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/start`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${liveToken}`,
        'Idempotency-Key': randomUUID(),
      },
    },
  ),
)
assert.equal(otherKey.status, 409)

const wrongDay = await liveGet(
  new Request(`https://example.test/api/daily/challenges/${liveDate}/play`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  }),
)
assert.equal(wrongDay.status, 404)

await cleanup()
console.log('verify:daily-play-api OK (handlers+Neon dev)')
