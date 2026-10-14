/**
 * DAILY RANKING UTC 10-minute auto-refresh (eng9E) — pure timing + decisions.
 * No real DB. Fake timers for delay math; source wiring for DailyResultScreen.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAILY_RANKING_BUCKET_MS } from '../src/daily/dailyRanking.ts'
import {
  DAILY_RANKING_BOUNDARY_SAFETY_MS,
  DAILY_RANKING_MAX_STALE_RETRIES,
  DAILY_RANKING_STALE_RETRY_MS,
  assertNotCompletionRelativeSchedule,
  currentDailyRankingBucketMs,
  decideDailyRankingQuietRefresh,
  isDailyRankingAsOfStale,
  msUntilNextDailyRankingRefresh,
  nextDailyRankingBoundaryMs,
  shouldRefreshDailyRankingOnResume,
  shouldScheduleDailyRankingAutoRefresh,
} from '../src/daily/dailyRankingRefresh.ts'
import { dailyResultViewModel } from '../src/daily/dailyResultPresentation.ts'
import type { DailySelfResultView } from '../src/daily/dailyRankingClient.ts'

const root = resolve(import.meta.dirname, '..')

function atUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss = 0,
  ms = 0,
): number {
  return Date.UTC(y, m - 1, d, hh, mm, ss, ms)
}

// --- 1–6: UTC boundaries (not completer-relative) ---
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 0, 0)),
  atUtc(2026, 10, 14, 0, 10, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 10, 0)),
  atUtc(2026, 10, 14, 0, 20, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 20, 0)),
  atUtc(2026, 10, 14, 0, 30, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 50, 0)),
  atUtc(2026, 10, 14, 1, 0, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 59, 59, 999)),
  atUtc(2026, 10, 14, 1, 0, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 23, 59, 0)),
  atUtc(2026, 10, 15, 0, 0, 0),
)
// Month / year UTC boundaries (Unix ms — timezone independent)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 31, 23, 59, 0)),
  atUtc(2026, 11, 1, 0, 0, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 12, 31, 23, 59, 0)),
  atUtc(2027, 1, 1, 0, 0, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 30, 0)),
  atUtc(2026, 10, 14, 0, 40, 0),
)
assert.equal(
  nextDailyRankingBoundaryMs(atUtc(2026, 10, 14, 0, 40, 0)),
  atUtc(2026, 10, 14, 0, 50, 0),
)

const midBucket = atUtc(2026, 10, 14, 12, 15, 0)
assert.equal(currentDailyRankingBucketMs(midBucket), atUtc(2026, 10, 14, 12, 10, 0))
assert.equal(nextDailyRankingBoundaryMs(midBucket), atUtc(2026, 10, 14, 12, 20, 0))
assert.equal(
  msUntilNextDailyRankingRefresh(midBucket),
  atUtc(2026, 10, 14, 12, 20, 0) + DAILY_RANKING_BOUNDARY_SAFETY_MS - midBucket,
)
assert.equal(DAILY_RANKING_BUCKET_MS, 600_000)

const completedAt = atUtc(2026, 10, 14, 12, 15, 0)
const scheduled = midBucket + msUntilNextDailyRankingRefresh(midBucket)
assert.equal(
  assertNotCompletionRelativeSchedule({
    completedAtMs: completedAt,
    scheduledFireMs: scheduled,
    nowMs: midBucket,
  }),
  true,
)
assert.notEqual(scheduled, completedAt + DAILY_RANKING_BUCKET_MS)
assert.notEqual(
  scheduled,
  completedAt + DAILY_RANKING_BUCKET_MS + DAILY_RANKING_BOUNDARY_SAFETY_MS,
)

// Recompute from "now" each time — not a fixed interval from an arbitrary start.
const delayA = msUntilNextDailyRankingRefresh(atUtc(2026, 10, 14, 12, 14, 0))
const delayB = msUntilNextDailyRankingRefresh(atUtc(2026, 10, 14, 12, 19, 0))
assert.notEqual(delayA, 600_000)
assert.notEqual(delayB, 600_000)
assert.ok(delayA > delayB)

// --- Schedule gate ---
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({ phaseKind: 'ranking_pending' }),
  true,
)
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({
    phaseKind: 'ready',
    rankingStatus: 'provisional',
  }),
  true,
)
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({
    phaseKind: 'ready',
    rankingStatus: 'final',
  }),
  false,
)
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({
    phaseKind: 'ranking_error',
    rankingErrorCode: 'unauthorized',
  }),
  false,
)
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({
    phaseKind: 'ranking_error',
    rankingErrorCode: 'error',
  }),
  true,
)
assert.equal(
  shouldScheduleDailyRankingAutoRefresh({ phaseKind: 'loading_self' }),
  false,
)

// --- 7–8 / 26: 12:15 pending → boundary expect 12:20; stale 12:10 retries ---
assert.equal(
  isDailyRankingAsOfStale({
    rankingAsOfMs: atUtc(2026, 10, 14, 12, 10, 0),
    expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
  }),
  true,
)

const staleDecision = decideDailyRankingQuietRefresh({
  phaseKind: 'ranking_pending',
  appliedRankingAsOfMs: null,
  expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
  staleRetriesUsed: 0,
  response: {
    kind: 'ok',
    challengeDate: '2026-10-14',
    expectedChallengeDate: '2026-10-14',
    rankingAsOfMs: atUtc(2026, 10, 14, 12, 10, 0),
    status: 'provisional',
    selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
})
assert.equal(staleDecision.action, 'retry_stale')
if (staleDecision.action === 'retry_stale') {
  assert.equal(staleDecision.retryAfterMs, DAILY_RANKING_STALE_RETRY_MS)
}

const apply1220 = decideDailyRankingQuietRefresh({
  phaseKind: 'ranking_pending',
  appliedRankingAsOfMs: null,
  expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
  staleRetriesUsed: 0,
  response: {
    kind: 'ok',
    challengeDate: '2026-10-14',
    expectedChallengeDate: '2026-10-14',
    rankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    status: 'provisional',
    selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
})
assert.deepEqual(apply1220, { action: 'apply', stopAutoRefresh: false })

assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ranking_pending',
    appliedRankingAsOfMs: null,
    expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
    staleRetriesUsed: 0,
    response: { kind: 'unavailable' },
  }).action,
  'keep_pending',
)

// Same rankingAsOf while already ready → ignore (no duplicate apply)
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
    staleRetriesUsed: 0,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
      status: 'provisional',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)

// Older than applied → ignore
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 30, 0),
    expectedBucketMs: atUtc(2026, 10, 14, 12, 30, 0),
    staleRetriesUsed: DAILY_RANKING_MAX_STALE_RETRIES,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
      status: 'provisional',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)

// Wrong date / participant → ignore
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ranking_pending',
    appliedRankingAsOfMs: null,
    expectedBucketMs: atUtc(2026, 10, 14, 12, 20, 0),
    staleRetriesUsed: 0,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-15',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 15, 0, 0, 0),
      status: 'final',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)

// --- 15–16: FINAL apply stops auto ---
assert.deepEqual(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 23, 50, 0),
    appliedRankingStatus: 'provisional',
    expectedBucketMs: atUtc(2026, 10, 15, 0, 0, 0),
    staleRetriesUsed: 0,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 15, 0, 0, 0),
      status: 'final',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }),
  { action: 'apply', stopAutoRefresh: true },
)

// FINAL must not roll back to a late provisional (even with equal/newer asOf tricks)
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 15, 0, 0, 0),
    appliedRankingStatus: 'final',
    expectedBucketMs: atUtc(2026, 10, 15, 0, 0, 0),
    staleRetriesUsed: 0,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 14, 23, 50, 0),
      status: 'provisional',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 15, 0, 0, 0),
    appliedRankingStatus: 'final',
    expectedBucketMs: atUtc(2026, 10, 15, 0, 10, 0),
    staleRetriesUsed: DAILY_RANKING_MAX_STALE_RETRIES,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      // Pathological: provisional claiming the close instant
      rankingAsOfMs: atUtc(2026, 10, 15, 0, 0, 0),
      status: 'provisional',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)

// Exhausted stale retries → no infinite loop (ignore when not newer)
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    appliedRankingStatus: 'provisional',
    expectedBucketMs: atUtc(2026, 10, 14, 12, 30, 0),
    staleRetriesUsed: DAILY_RANKING_MAX_STALE_RETRIES,
    response: {
      kind: 'ok',
      challengeDate: '2026-10-14',
      expectedChallengeDate: '2026-10-14',
      rankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
      status: 'provisional',
      selfParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedParticipantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }).action,
  'ignore',
)

// Delayed timer + resume: bucket crossed once → single refresh signal (no double cadence)
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 14, 12, 20, 2),
    lastAttemptMs: atUtc(2026, 10, 14, 12, 15, 0),
    appliedRankingAsOfMs: null,
    phaseKind: 'ranking_pending',
  }),
  true,
)
// Same bucket after a delayed timer would fire — resume must not also force another fetch
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 14, 12, 20, 5),
    lastAttemptMs: atUtc(2026, 10, 14, 12, 20, 1, 500),
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    phaseKind: 'ready',
    rankingStatus: 'provisional',
  }),
  false,
)

// --- 18 / 20: soft error vs unauthorized ---
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    expectedBucketMs: atUtc(2026, 10, 14, 12, 30, 0),
    staleRetriesUsed: 0,
    response: { kind: 'error' },
  }).action,
  'soft_error',
)
assert.equal(
  decideDailyRankingQuietRefresh({
    phaseKind: 'ready',
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    expectedBucketMs: atUtc(2026, 10, 14, 12, 30, 0),
    staleRetriesUsed: 0,
    response: { kind: 'unauthorized' },
  }).action,
  'hard_unauthorized',
)

// --- 21–22: resume only when bucket crossed ---
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 14, 12, 25, 0),
    lastAttemptMs: atUtc(2026, 10, 14, 12, 15, 0),
    appliedRankingAsOfMs: null,
    phaseKind: 'ranking_pending',
  }),
  true,
)
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 14, 12, 18, 0),
    lastAttemptMs: atUtc(2026, 10, 14, 12, 15, 0),
    appliedRankingAsOfMs: null,
    phaseKind: 'ranking_pending',
  }),
  false,
)
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 14, 12, 35, 0),
    lastAttemptMs: atUtc(2026, 10, 14, 12, 20, 1),
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 12, 20, 0),
    phaseKind: 'ready',
    rankingStatus: 'provisional',
  }),
  true,
)
assert.equal(
  shouldRefreshDailyRankingOnResume({
    nowMs: atUtc(2026, 10, 15, 0, 5, 0),
    lastAttemptMs: atUtc(2026, 10, 14, 23, 55, 0),
    appliedRankingAsOfMs: atUtc(2026, 10, 14, 23, 50, 0),
    phaseKind: 'ready',
    rankingStatus: 'final',
  }),
  false,
)

// --- Presentation: soft refresh error keeps ranking rows + TRY AGAIN ---
const selfStub = {
  challengeDate: '2026-10-14',
  participantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  nickname: 'Self',
  acceptedAt: '2026-10-14T00:05:00.000Z',
  completedAt: '2026-10-14T12:15:00.000Z',
  totalCoins: 12,
  threeCoinsComplete: 3,
  coinBagHits: 5,
  totalOpens: 10,
  coinBagHitRate: { numerator: 5, denominator: 10 },
  rounds: [],
} as unknown as DailySelfResultView

const rankingStub = {
  challengeDate: '2026-10-14',
  status: 'provisional' as const,
  rankingAsOf: '2026-10-14T12:20:00.000Z',
  topEntries: [
    {
      participantId: selfStub.participantId,
      rank: 1,
      nickname: 'Self',
      totalCoins: 12,
      threeCoinsComplete: 3,
      coinBagHits: 5,
      totalOpens: 10,
      coinBagHitRate: { numerator: 5, denominator: 10 },
      isSelf: true,
    },
  ],
  self: {
    participantId: selfStub.participantId,
    rank: 1,
    nickname: 'Self',
    totalCoins: 12,
    threeCoinsComplete: 3,
    coinBagHits: 5,
    totalOpens: 10,
    coinBagHitRate: { numerator: 5, denominator: 10 },
    isSelf: true,
  },
  selfInTop: true,
  totalRankedParticipants: 1,
}

const softVm = dailyResultViewModel({
  kind: 'ready',
  self: selfStub,
  ranking: rankingStub,
  refreshError: true,
})
assert.equal(softVm.rows.length, 1)
assert.equal(softVm.showRankingRetry, true)
assert.equal(softVm.statusKey, 'groupResultError')
assert.equal(softVm.showSelfScores, true)

const pendingVm = dailyResultViewModel({
  kind: 'ranking_pending',
  self: selfStub,
})
assert.equal(pendingVm.statusKey, 'dailyRankingUpdatesEvery10Minutes')
assert.equal(pendingVm.showRankingRetry, true)

// --- Fake timer: delay shrinks as clock advances toward boundary ---
let fakeNow = atUtc(2026, 10, 14, 12, 15, 0)
const fires: number[] = []
const delay = () => msUntilNextDailyRankingRefresh(fakeNow)
let remaining = delay()
const stepMs = 60_000
while (remaining > 0 && fires.length < 20) {
  const advance = Math.min(stepMs, remaining)
  fakeNow += advance
  remaining = delay()
  if (remaining === 0 || fakeNow >= atUtc(2026, 10, 14, 12, 20, 0) + DAILY_RANKING_BOUNDARY_SAFETY_MS) {
    fires.push(fakeNow)
    break
  }
}
assert.equal(fires.length, 1)
assert.ok(fires[0]! >= atUtc(2026, 10, 14, 12, 20, 0) + DAILY_RANKING_BOUNDARY_SAFETY_MS)

// --- Source wiring ---
const screen = readFileSync(
  resolve(root, 'src/components/DailyResultScreen.tsx'),
  'utf8',
)
assert.match(screen, /msUntilNextDailyRankingRefresh/)
assert.match(screen, /visibilitychange/)
assert.match(screen, /decideDailyRankingQuietRefresh/)
assert.match(screen, /fetchDailyRanking/)
assert.doesNotMatch(screen, /setInterval\(\s*[^,]+,\s*600_?000/)
assert.match(screen, /stopAutoRef/)
assert.match(screen, /refreshError/)
// Quiet path must not re-fetch personal RESULT on boundary
assert.match(screen, /Quiet ranking-only refresh/)
assert.doesNotMatch(
  screen,
  /runQuietRefresh[\s\S]{0,400}fetchDailySelfResult/,
)

const refreshMod = readFileSync(
  resolve(root, 'src/daily/dailyRankingRefresh.ts'),
  'utf8',
)
assert.match(refreshMod, /nextDailyRankingBoundaryMs/)
assert.match(refreshMod, /DAILY_RANKING_BOUNDARY_SAFETY_MS/)
assert.doesNotMatch(refreshMod, /completedAt\s*\+\s*DAILY_RANKING_BUCKET/)

const presentation = readFileSync(
  resolve(root, 'src/daily/dailyResultPresentation.ts'),
  'utf8',
)
assert.match(presentation, /refreshError/)

// GROUP / OPEN paths untouched by this module
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/components/GroupResultScreen.tsx'), 'utf8'),
  /dailyRankingRefresh/,
)
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/daily/dailyLocalOpen.ts'), 'utf8'),
  /dailyRankingRefresh/,
)
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/daily/dailyPlayClient.ts'), 'utf8'),
  /dailyRankingRefresh/,
)

assert.match(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
  /verify:daily-ranking-refresh/,
)

console.log('verify:daily-ranking-refresh OK')
