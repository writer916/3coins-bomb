/** DAILY play DB layer: timing rules, source guards, optional Neon dev checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  canFinalizeDailyRoundTimeout,
  dailyChallengePeriod,
  dailyRoundTimeoutFinalizeAtMs,
  dailyRoundUiDeadlineMs,
  DAILY_OPERATION_GRACE_SECONDS,
  DAILY_ROUND_LIMIT_SECONDS,
  validateDailyOperationTiming,
} from '../src/daily/dailyTime.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import { hashDailyParticipantCapability } from '../server/auth/dailyTokens.ts'

const root = resolve(import.meta.dirname, '..')
const playSource = readFileSync(resolve(root, 'server/db/dailyPlay.ts'), 'utf8')
const timeSource = readFileSync(resolve(root, 'src/daily/dailyTime.ts'), 'utf8')

assert.match(playSource, /export async function startDailyRound/)
assert.match(playSource, /export async function getDailyPlayState/)
assert.match(playSource, /for update of participant/)
assert.match(playSource, /on conflict \(start_request_id\) do nothing/)
assert.match(playSource, /question_order\[progress\.terminal_count \+ 1\]/)
assert.match(playSource, /timed_out/)
assert.match(playSource, /make_interval\(secs =>/)
assert.match(playSource, /challenge_ends_at/)
assert.doesNotMatch(playSource, /bomb_bag_number/)
assert.doesNotMatch(playSource, /bombBagNumber|coinBagNumbers/)
assert.match(
  playSource,
  /coin_bag_numbers/,
  'timeout path may count coin hits server-side without returning placements',
)
assert.doesNotMatch(playSource, /console\./)
assert.match(timeSource, /dailyRoundTimeoutFinalizeAtMs/)
assert.match(timeSource, /canFinalizeDailyRoundTimeout/)

assert.equal(DAILY_ROUND_LIMIT_SECONDS + DAILY_OPERATION_GRACE_SECONDS, 62)
assert.equal(DAILY_CHALLENGE_ROUNDS, 20)

const started = Date.parse('2099-07-01T12:00:00.000Z')
const dayEnd = dailyChallengePeriod('2099-07-01').endsAtMs
assert.equal(dailyRoundUiDeadlineMs(started), started + 60_000)
assert.equal(dailyRoundTimeoutFinalizeAtMs(started), started + 62_000)

// Within delivery grace after UI zero, OPEN with R=1 remains acceptable and
// TIME OUT must not finalize yet.
assert.equal(
  validateDailyOperationTiming({
    startedAtMs: started,
    receivedAtMs: started + 61_500,
    remainingSecondsAtTap: 1,
    challengeEndsAtMs: dayEnd,
  }).accepted,
  true,
)
assert.equal(
  canFinalizeDailyRoundTimeout({
    startedAtMs: started,
    nowMs: started + 61_500,
    challengeEndsAtMs: dayEnd,
  }),
  false,
)
assert.equal(
  canFinalizeDailyRoundTimeout({
    startedAtMs: started,
    nowMs: started + 62_000,
    challengeEndsAtMs: dayEnd,
  }),
  true,
)

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
  console.log('verify:daily-play-db OK (timing+source; Neon dev skipped)')
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
const { getDailyPlayState, startDailyRound } = await import(
  '../server/db/dailyPlay.ts'
)

const date = '2099-07-01'
const token = `3cb_dp1_${'A'.repeat(42)}A`
const tokenHash = hashDailyParticipantCapability(token)
const orderSql = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => index + 1).join(',')}]::smallint[]`,
)

async function cleanup(targetDate: string) {
  await getDatabase().execute(sql`
    delete from daily_challenges where challenge_date = ${targetDate}::date
  `)
}

async function seedParticipant(
  targetDate: string,
  hash: string,
  nickname: string,
) {
  await persistOrLoadDailyQuestionSet({
    challengeDate: targetDate,
    rounds: provideDailyQuestionRounds(),
  })
  const inserted = await getDatabase().execute<{ id: string }>(sql`
    insert into daily_challenge_participants (
      challenge_date,
      display_nickname,
      nickname_key,
      auth_token_hash,
      join_request_id,
      question_order
    ) values (
      ${targetDate}::date,
      ${nickname},
      ${nickname.toLowerCase()},
      ${hash},
      ${randomUUID()}::uuid,
      ${orderSql}
    )
    returning id
  `)
  assert.ok(inserted.rows[0]?.id)
}

await cleanup(date)
await seedParticipant(date, tokenHash, 'PlayDb')

const t0 = Date.parse('2099-07-01T12:00:00.000Z')
const startA = randomUUID()
const first = await startDailyRound({
  challengeDate: date,
  authTokenHash: tokenHash,
  startRequestId: startA,
  nowMs: t0,
})
assert.equal(first.status, 'started')
assert.equal(first.state.activeAttempt?.roundNumber, 1)
assert.equal(first.state.completedRounds, 0)
assert.equal(first.state.nextRoundNumber, 1)
assert.ok(first.state.activeAttempt)
assert.equal(
  first.state.activeAttempt.deadlineAt,
  new Date(t0 + 60_000).toISOString(),
)
assert.equal(first.state.activeAttempt.opens.length, 0)
assert.ok(first.state.activeAttempt.bagCount >= 3)

const replay = await startDailyRound({
  challengeDate: date,
  authTokenHash: tokenHash,
  startRequestId: startA,
  nowMs: t0 + 1_000,
})
assert.equal(replay.status, 'replayed')
assert.equal(replay.state.activeAttempt?.roundNumber, 1)

const conflict = await startDailyRound({
  challengeDate: date,
  authTokenHash: tokenHash,
  startRequestId: randomUUID(),
  nowMs: t0 + 2_000,
})
assert.equal(conflict.status, 'rejected')
assert.equal(conflict.reason, 'already_active')

const mid = await getDailyPlayState({
  challengeDate: date,
  authTokenHash: tokenHash,
  nowMs: t0 + 60_000,
})
assert.equal(mid?.activeAttempt?.roundNumber, 1)
assert.equal(mid?.completedRounds, 0)

const grace = await getDailyPlayState({
  challengeDate: date,
  authTokenHash: tokenHash,
  nowMs: t0 + 61_500,
})
assert.equal(grace?.activeAttempt?.roundNumber, 1, 'grace must retain active')

const timed = await getDailyPlayState({
  challengeDate: date,
  authTokenHash: tokenHash,
  nowMs: t0 + 62_000,
})
assert.equal(timed?.activeAttempt, null)
assert.equal(timed?.completedRounds, 1)
assert.equal(timed?.nextRoundNumber, 2)
assert.equal(timed?.completedAt, null)

const second = await startDailyRound({
  challengeDate: date,
  authTokenHash: tokenHash,
  startRequestId: randomUUID(),
  nowMs: t0 + 63_000,
})
assert.equal(second.status, 'started')
assert.equal(second.state.activeAttempt?.roundNumber, 2)

// Advance through remaining rounds via timeout finalize.
let cursor = t0 + 63_000
for (let round = 2; round <= 20; round += 1) {
  const active = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: tokenHash,
    nowMs: cursor,
  })
  if (!active?.activeAttempt) {
    const startedRound = await startDailyRound({
      challengeDate: date,
      authTokenHash: tokenHash,
      startRequestId: randomUUID(),
      nowMs: cursor,
    })
    assert.equal(startedRound.status, 'started')
    assert.equal(startedRound.state.activeAttempt?.roundNumber, round)
  }
  cursor += 62_000
  const after = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: tokenHash,
    nowMs: cursor,
  })
  assert.equal(after?.completedRounds, round)
  if (round < 20) {
    assert.equal(after?.activeAttempt, null)
    assert.equal(after?.completedAt, null)
  } else {
    assert.ok(after?.completedAt, 'round 20 timeout completes participation')
    assert.equal(after?.expiredAt, null)
    assert.equal(after?.nextRoundNumber, null)
  }
}

const exhausted = await startDailyRound({
  challengeDate: date,
  authTokenHash: tokenHash,
  startRequestId: randomUUID(),
  nowMs: cursor + 1_000,
})
assert.equal(exhausted.status, 'rejected')
assert.ok(
  exhausted.reason === 'completed' || exhausted.reason === 'rounds_exhausted',
)

// UTC day end: new participant cannot start after midnight.
const lateDate = '2099-07-02'
await cleanup(lateDate)
const lateHash = hashDailyParticipantCapability(`3cb_dp1_${'B'.repeat(42)}A`)
await seedParticipant(lateDate, lateHash, 'Late')
const afterDay = await startDailyRound({
  challengeDate: lateDate,
  authTokenHash: lateHash,
  startRequestId: randomUUID(),
  nowMs: dailyChallengePeriod(lateDate).endsAtMs,
})
assert.equal(afterDay.status, 'rejected')
assert.ok(
  afterDay.reason === 'challenge_ended' || afterDay.reason === 'expired',
)

assert.doesNotMatch(JSON.stringify(first.state), /bomb/i)
assert.doesNotMatch(JSON.stringify(first.state), /coinBag/i)

await cleanup(date)
await cleanup(lateDate)

console.log('verify:daily-play-db OK (timing+source+Neon dev)')
