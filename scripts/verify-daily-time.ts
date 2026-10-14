/** DAILY timer and UTC/local challenge-period helpers (no browser or database). */
import assert from 'node:assert/strict'
import {
  calculateDailyRemainingSeconds,
  dailyChallengePeriod,
  dailyElapsedSecondsAtTap,
  dailyTimedOutElapsedSeconds,
  estimateDailyServerNowMs,
  formatDailyChallengePeriod,
  isDailyOperationBeforeChallengeEnd,
  isDailyRoundTapTimely,
  resolveDailyTimeZone,
  validateDailyOperationTiming,
} from '../src/daily/dailyTime'

const deadline = 60_000
for (const [remainingMs, expected] of [
  [60_000, 60],
  [59_001, 60],
  [59_000, 59],
  [1_001, 2],
  [1_000, 1],
  [999, 1],
  [1, 1],
  [0, 0],
  [-1, 0],
] as const) {
  assert.equal(
    calculateDailyRemainingSeconds(deadline, deadline - remainingMs),
    expected,
  )
}
assert.equal(isDailyRoundTapTimely(deadline, deadline - 1), true)
assert.equal(isDailyRoundTapTimely(deadline, deadline), false)

assert.equal(dailyElapsedSecondsAtTap(60), 0)
assert.equal(dailyElapsedSecondsAtTap(42), 18)
assert.equal(dailyElapsedSecondsAtTap(1), 59)
assert.equal(dailyTimedOutElapsedSeconds(), 60)
for (const invalid of [0, 61, -1, 1.5, NaN, '1', null]) {
  assert.throws(() => dailyElapsedSecondsAtTap(invalid))
}

assert.equal(estimateDailyServerNowMs(10_000, 500, 1_250), 10_750)
assert.throws(() => estimateDailyServerNowMs(10_000, 500, 499))

const normal = validateDailyOperationTiming({
  startedAtMs: 0,
  receivedAtMs: 18_400,
  remainingSecondsAtTap: 42,
})
assert.deepEqual(normal, { accepted: true, elapsedSeconds: 18 })

// Display 1 belongs to [59s, 60s); a short late arrival is accepted.
const graceful = validateDailyOperationTiming({
  startedAtMs: 0,
  receivedAtMs: 61_500,
  remainingSecondsAtTap: 1,
})
assert.deepEqual(graceful, { accepted: true, elapsedSeconds: 59 })

assert.deepEqual(
  validateDailyOperationTiming({
    startedAtMs: 0,
    receivedAtMs: 62_000,
    remainingSecondsAtTap: 1,
  }),
  { accepted: false, reason: 'round_grace_exceeded' },
)
assert.deepEqual(
  validateDailyOperationTiming({
    startedAtMs: 0,
    receivedAtMs: 1_000,
    remainingSecondsAtTap: 0,
  }),
  { accepted: false, reason: 'invalid_remaining_seconds' },
)
assert.deepEqual(
  validateDailyOperationTiming({
    startedAtMs: 0,
    receivedAtMs: 5_000,
    remainingSecondsAtTap: 42,
  }),
  { accepted: false, reason: 'received_before_claimed_tap_window' },
)

const challengeEnd = 61_750
assert.equal(isDailyOperationBeforeChallengeEnd(challengeEnd - 1, challengeEnd), true)
assert.equal(isDailyOperationBeforeChallengeEnd(challengeEnd, challengeEnd), false)
assert.deepEqual(
  validateDailyOperationTiming({
    startedAtMs: 0,
    receivedAtMs: challengeEnd,
    remainingSecondsAtTap: 1,
    challengeEndsAtMs: challengeEnd,
  }),
  { accepted: false, reason: 'challenge_ended' },
)

const period = dailyChallengePeriod('2026-10-14')
assert.deepEqual(period, {
  challengeDate: '2026-10-14',
  startsAtMs: Date.parse('2026-10-14T00:00:00.000Z'),
  endsAtMs: Date.parse('2026-10-15T00:00:00.000Z'),
  startsAt: '2026-10-14T00:00:00.000Z',
  endsAt: '2026-10-15T00:00:00.000Z',
})

assert.deepEqual(formatDailyChallengePeriod('2026-10-14', 'Asia/Tokyo'), {
  challengeDate: '2026-10-14',
  timeZone: 'Asia/Tokyo',
  usedUtcFallback: false,
  startsAt: '2026-10-14 09:00',
  endsAt: '2026-10-15 09:00',
})
assert.deepEqual(
  formatDailyChallengePeriod('2026-10-14', 'America/New_York'),
  {
    challengeDate: '2026-10-14',
    timeZone: 'America/New_York',
    usedUtcFallback: false,
    startsAt: '2026-10-13 20:00',
    endsAt: '2026-10-14 20:00',
  },
)
assert.deepEqual(
  formatDailyChallengePeriod('2026-10-14', 'America/Los_Angeles'),
  {
    challengeDate: '2026-10-14',
    timeZone: 'America/Los_Angeles',
    usedUtcFallback: false,
    startsAt: '2026-10-13 17:00',
    endsAt: '2026-10-14 17:00',
  },
)
assert.deepEqual(formatDailyChallengePeriod('2026-10-14', 'Europe/London'), {
  challengeDate: '2026-10-14',
  timeZone: 'Europe/London',
  usedUtcFallback: false,
  startsAt: '2026-10-14 01:00',
  endsAt: '2026-10-15 01:00',
})

// US daylight-saving transition: one UTC day spans 19:00 EST to 20:00 EDT.
assert.deepEqual(
  formatDailyChallengePeriod('2026-03-08', 'America/New_York'),
  {
    challengeDate: '2026-03-08',
    timeZone: 'America/New_York',
    usedUtcFallback: false,
    startsAt: '2026-03-07 19:00',
    endsAt: '2026-03-08 20:00',
  },
)
// UK daylight-saving transition: UTC boundaries remain fixed while local end shifts.
assert.deepEqual(formatDailyChallengePeriod('2026-03-29', 'Europe/London'), {
  challengeDate: '2026-03-29',
  timeZone: 'Europe/London',
  usedUtcFallback: false,
  startsAt: '2026-03-29 00:00',
  endsAt: '2026-03-30 01:00',
})

assert.deepEqual(resolveDailyTimeZone('Not/A_Time_Zone'), {
  timeZone: 'UTC',
  usedUtcFallback: true,
})
assert.deepEqual(formatDailyChallengePeriod('2026-10-14', undefined), {
  challengeDate: '2026-10-14',
  timeZone: 'UTC',
  usedUtcFallback: true,
  startsAt: '2026-10-14 00:00',
  endsAt: '2026-10-15 00:00',
})

console.log('verify:daily-time OK')
