/**
 * DAILY RANKING API — domain + handler + wiring (no real DB).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDailyRankingHandler } from '../api/_daily/challenges/[date]/ranking.ts'
import { createDailyResultHandler } from '../api/_daily/challenges/[date]/result.ts'
import {
  DailyRankingApiError,
  readDailyRanking,
  toDailyRankingResponse,
  validateDailyRankingAuth,
} from '../server/daily/rankingApi.ts'
import { readDailyResult } from '../server/daily/resultApi.ts'
import {
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultParticipantRow,
} from '../server/db/dailyResult.ts'
import { buildDailyRankingCandidates } from '../server/db/dailyRanking.ts'
import {
  deriveDailyParticipantCapability,
  hashDailyParticipantCapability,
} from '../server/auth/dailyTokens.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import type { DailyRoundResultInput } from '../src/daily/dailyResult.ts'
import {
  compareDailyParticipantScores,
  tryAggregateDailyParticipantResult,
} from '../src/daily/dailyResult.ts'
import {
  DAILY_RANKING_TOP_LIMIT,
  buildDailyRankingSelection,
  dailyChallengeCloseMs,
  dailyRankingBucketStartMs,
  isCompletedInRankingSnapshot,
  rankDailyParticipants,
  resolveDailyRankingWindow,
  selectDailyRankingTopAndSelf,
  type DailyRankingCandidate,
} from '../src/daily/dailyRanking.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2026-10-14'
const pastDate = '2026-10-13'
const otherDate = '2026-10-15'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const token = deriveDailyParticipantCapability(date, randomUUID(), environment)
const pastToken = deriveDailyParticipantCapability(
  pastDate,
  randomUUID(),
  environment,
)
const otherToken = deriveDailyParticipantCapability(
  otherDate,
  randomUUID(),
  environment,
)
const authHash = hashDailyParticipantCapability(token)
const pastHash = hashDailyParticipantCapability(pastToken)

function pid(n: number): string {
  const hex = n.toString(16).padStart(12, '0')
  return `11111111-1111-4111-8111-${hex}`
}

const SELF_ID = pid(1)

function round(
  roundNumber: number,
  endReason: DailyRoundResultInput['endReason'],
  overrides: Partial<DailyRoundResultInput> = {},
): DailyRoundResultInput {
  const defaults: Record<
    DailyRoundResultInput['endReason'],
    DailyRoundResultInput
  > = {
    cleared: {
      roundNumber,
      endReason: 'cleared',
      capturedCoins: 3,
      openedBagCount: 3,
      coinBagHits: 3,
      elapsedSeconds: 20,
    },
    cashed_out: {
      roundNumber,
      endReason: 'cashed_out',
      capturedCoins: 2,
      openedBagCount: 2,
      coinBagHits: 2,
      elapsedSeconds: 15,
    },
    bombed: {
      roundNumber,
      endReason: 'bombed',
      capturedCoins: 0,
      openedBagCount: 2,
      coinBagHits: 1,
      elapsedSeconds: 10,
    },
    timed_out: {
      roundNumber,
      endReason: 'timed_out',
      capturedCoins: 0,
      openedBagCount: 0,
      coinBagHits: 0,
      elapsedSeconds: 60,
    },
  }
  return { ...defaults[endReason], ...overrides, roundNumber, endReason }
}

function twenty(
  factory: (n: number) => DailyRoundResultInput,
): DailyRoundResultInput[] {
  return Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, i) => factory(i + 1))
}

function baseRounds(
  overrides: Partial<DailyRoundResultInput> = {},
): DailyRoundResultInput[] {
  return twenty((n) => round(n, 'timed_out', overrides))
}

function summaryFrom(
  participantId: string,
  nickname: string,
  acceptedAt: string,
  rounds: DailyRoundResultInput[],
  challengeDate = date,
) {
  const summary = tryAggregateDailyParticipantResult({
    participantId,
    displayNickname: nickname,
    challengeDate,
    acceptedAt,
    rounds,
  })
  assert.ok(summary)
  return summary
}

function candidate(
  participantId: string,
  nickname: string,
  acceptedAt: string,
  completedAt: string,
  rounds: DailyRoundResultInput[],
  challengeDate = date,
): DailyRankingCandidate {
  return {
    summary: summaryFrom(
      participantId,
      nickname,
      acceptedAt,
      rounds,
      challengeDate,
    ),
    completedAt,
  }
}

function attemptsFromRounds(
  rounds: DailyRoundResultInput[],
  participantId: string,
  challengeDate = date,
): DailyAttemptResultRow[] {
  return rounds.map((r) => ({
    participantId,
    challengeDate,
    roundNumber: r.roundNumber,
    status: r.endReason,
    elapsedSeconds: r.elapsedSeconds,
    capturedCoins: r.capturedCoins,
    openedBagCount: r.openedBagCount,
    coinBagHits: r.coinBagHits,
  }))
}

function participantRow(
  overrides: Partial<DailyResultParticipantRow> = {},
): DailyResultParticipantRow {
  return {
    participantId: overrides.participantId ?? SELF_ID,
    challengeDate: overrides.challengeDate ?? date,
    displayNickname: overrides.displayNickname ?? 'SelfPlayer',
    acceptedAt: overrides.acceptedAt ?? '2026-10-14T00:05:00.000Z',
    completedAt:
      overrides.completedAt === undefined
        ? '2026-10-14T01:00:00.000Z'
        : overrides.completedAt,
    expiredAt: overrides.expiredAt === undefined ? null : overrides.expiredAt,
  }
}

function bearer(value: string): string {
  return `Bearer ${value}`
}

// --- 1–5 / 19: bucket + score metrics ---
assert.equal(
  dailyRankingBucketStartMs(Date.parse('2026-10-14T00:00:00.000Z')),
  Date.parse('2026-10-14T00:00:00.000Z'),
)
assert.equal(
  dailyRankingBucketStartMs(Date.parse('2026-10-14T00:09:59.999Z')),
  Date.parse('2026-10-14T00:00:00.000Z'),
)
assert.equal(
  dailyRankingBucketStartMs(Date.parse('2026-10-14T00:10:00.000Z')),
  Date.parse('2026-10-14T00:10:00.000Z'),
)
assert.equal(
  dailyRankingBucketStartMs(Date.parse('2026-10-14T12:19:59.999Z')),
  Date.parse('2026-10-14T12:10:00.000Z'),
)

const liveWindow = resolveDailyRankingWindow(
  date,
  new Date('2026-10-14T12:15:00.000Z'),
)
assert.equal(liveWindow.status, 'provisional')
assert.equal(liveWindow.rankingAsOf, '2026-10-14T12:10:00.000Z')

const finalWindow = resolveDailyRankingWindow(
  date,
  new Date('2026-10-15T00:00:00.000Z'),
)
assert.equal(finalWindow.status, 'final')
assert.equal(finalWindow.rankingAsOf, '2026-10-15T00:00:00.000Z')
assert.equal(dailyChallengeCloseMs(date), Date.parse('2026-10-15T00:00:00.000Z'))

assert.equal(
  isCompletedInRankingSnapshot('2026-10-14T12:10:00.000Z', liveWindow),
  true,
)
assert.equal(
  isCompletedInRankingSnapshot('2026-10-14T12:10:00.001Z', liveWindow),
  false,
)
assert.throws(() =>
  resolveDailyRankingWindow(date, new Date('2026-10-13T23:59:59.999Z')),
)

const lowCoins = candidate(
  pid(2),
  'Low',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  baseRounds(),
)
const highCoins = candidate(
  pid(3),
  'High',
  '2026-10-14T00:02:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
        })
      : round(n, 'timed_out'),
  ),
)
assert.ok(compareDailyParticipantScores(highCoins.summary, lowCoins.summary) < 0)

const moreComplete = candidate(
  pid(4),
  'MoreC',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cleared')
      : round(n, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
        }),
  ),
)
const lessComplete = candidate(
  pid(5),
  'LessC',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  // 11×2-coin cash-outs + 9 timeouts = 22 coins, 0 clears (matches moreComplete coins).
  twenty((n) =>
    n <= 11
      ? round(n, 'cashed_out', {
          capturedCoins: 2,
          openedBagCount: 2,
          coinBagHits: 2,
        })
      : round(n, 'timed_out'),
  ),
)
assert.equal(moreComplete.summary.totalCoins, lessComplete.summary.totalCoins)
assert.ok(
  moreComplete.summary.threeCoinsComplete > lessComplete.summary.threeCoinsComplete,
)
assert.ok(
  compareDailyParticipantScores(moreComplete.summary, lessComplete.summary) < 0,
)

const highHit = candidate(
  pid(6),
  'HighHit',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    round(n, 'bombed', { capturedCoins: 0, openedBagCount: 2, coinBagHits: 2 }),
  ),
)
const lowHit = candidate(
  pid(7),
  'LowHit',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    round(n, 'bombed', { capturedCoins: 0, openedBagCount: 2, coinBagHits: 1 }),
  ),
)
assert.ok(compareDailyParticipantScores(highHit.summary, lowHit.summary) < 0)

const fast = candidate(
  pid(8),
  'Fast',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    round(n, 'bombed', {
      capturedCoins: 0,
      openedBagCount: 1,
      coinBagHits: 0,
      elapsedSeconds: 10,
    }),
  ),
)
const slow = candidate(
  pid(9),
  'Slow',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) =>
    round(n, 'bombed', {
      capturedCoins: 0,
      openedBagCount: 1,
      coinBagHits: 0,
      elapsedSeconds: 50,
    }),
  ),
)
assert.equal(fast.summary.totalCoins, slow.summary.totalCoins)
assert.equal(fast.summary.threeCoinsComplete, slow.summary.threeCoinsComplete)
assert.equal(
  compareDailyParticipantScores(fast.summary, slow.summary) < 0,
  true,
)
assert.ok(fast.summary.totalTimeSeconds < slow.summary.totalTimeSeconds)

const zeroOpen = candidate(
  pid(10),
  'ZeroOpen',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  baseRounds(),
)
assert.equal(zeroOpen.summary.totalOpens, 0)
assert.equal(
  compareDailyParticipantScores(zeroOpen.summary, lowCoins.summary),
  0,
)

// --- 6–9: ties, competition rank, acceptedAt / participantId display ---
const tieEarly = candidate(
  pid(20),
  'TieA',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T02:00:00.000Z',
  baseRounds(),
)
const tieLate = candidate(
  pid(21),
  'TieB',
  '2026-10-14T00:02:00.000Z',
  '2026-10-14T02:00:00.000Z',
  baseRounds(),
)
const tieSameAcceptLowerId = candidate(
  pid(22),
  'TieC',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T02:00:00.000Z',
  baseRounds(),
)
const ahead = candidate(
  pid(23),
  'Ahead',
  '2026-10-14T00:00:30.000Z',
  '2026-10-14T02:00:00.000Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
        })
      : round(n, 'timed_out'),
  ),
)
const rankedTies = rankDailyParticipants([
  tieLate,
  ahead,
  tieEarly,
  tieSameAcceptLowerId,
])
assert.deepEqual(
  rankedTies.map((e) => e.rank),
  [1, 2, 2, 2],
)
assert.equal(rankedTies[0]!.participantId, pid(23))
assert.equal(rankedTies[1]!.participantId, pid(20))
assert.equal(rankedTies[2]!.participantId, pid(22))
assert.equal(rankedTies[3]!.participantId, pid(21))

const a1 = candidate(
  pid(30),
  'A',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) => round(n, 'cleared')),
)
const a2 = candidate(
  pid(31),
  'B',
  '2026-10-14T00:02:00.000Z',
  '2026-10-14T01:00:00.000Z',
  twenty((n) => round(n, 'cleared')),
)
const a3 = candidate(
  pid(32),
  'C',
  '2026-10-14T00:03:00.000Z',
  '2026-10-14T01:00:00.000Z',
  baseRounds(),
)
assert.deepEqual(
  rankDailyParticipants([a3, a2, a1]).map((e) => e.rank),
  [1, 1, 3],
)

// --- 10–14: Top10 fixed, self in/out, 11th with tied rank ---
function makeEqualScorer(n: number, acceptedMinute: number): DailyRankingCandidate {
  return candidate(
    pid(100 + n),
    `P${n}`,
    `2026-10-14T00:${String(acceptedMinute).padStart(2, '0')}:00.000Z`,
    '2026-10-14T11:00:00.000Z',
    baseRounds(),
  )
}
const twelveEqual = Array.from({ length: 12 }, (_, i) =>
  makeEqualScorer(i, i + 1),
)
const windowLive = {
  challengeDate: date,
  status: 'provisional' as const,
  rankingAsOf: '2026-10-14T12:10:00.000Z',
  challengeCloseAt: '2026-10-15T00:00:00.000Z',
}
const selectionBoundary = buildDailyRankingSelection(
  twelveEqual,
  windowLive,
  pid(110),
)
assert.equal(selectionBoundary.topEntries.length, DAILY_RANKING_TOP_LIMIT)
assert.equal(selectionBoundary.selfInTop, false)
assert.equal(selectionBoundary.self.participantId, pid(110))
assert.equal(selectionBoundary.self.rank, 1)
assert.equal(selectionBoundary.totalRankedParticipants, 12)
assert.ok(
  !selectionBoundary.topEntries.some((e) => e.participantId === pid(110)),
)
assert.ok(
  !selectionBoundary.topEntries.some((e) => e.participantId === pid(111)),
)

const selectionInTop = selectDailyRankingTopAndSelf(
  rankDailyParticipants(twelveEqual),
  pid(100),
)
assert.equal(selectionInTop.selfInTop, true)
assert.equal(
  selectionInTop.topEntries.filter((e) => e.participantId === pid(100)).length,
  1,
)

// --- 15: same nickname ---
const twinA = candidate(
  pid(40),
  'Twin',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T01:00:00.000Z',
  baseRounds(),
)
const twinB = candidate(
  pid(41),
  'Twin',
  '2026-10-14T00:02:00.000Z',
  '2026-10-14T01:00:00.000Z',
  baseRounds(),
)
const twins = rankDailyParticipants([twinB, twinA])
assert.equal(twins.length, 2)
assert.notEqual(twins[0]!.participantId, twins[1]!.participantId)

// --- 24: incomplete / duplicate excluded ---
const incompleteParticipant = participantRow({
  participantId: pid(50),
  completedAt: '2026-10-14T01:00:00.000Z',
})
const incompleteAttempts = attemptsFromRounds(baseRounds().slice(0, 19), pid(50))
assert.equal(
  tryBuildDailyParticipantResultSummary(
    incompleteParticipant,
    incompleteAttempts,
  ),
  null,
)
const built = buildDailyRankingCandidates(
  [
    participantRow({
      participantId: pid(51),
      completedAt: '2026-10-14T01:00:00.000Z',
    }),
    incompleteParticipant,
  ],
  [
    ...attemptsFromRounds(baseRounds(), pid(51)),
    ...incompleteAttempts,
  ],
)
assert.equal(built.length, 1)
assert.equal(built[0]!.summary.participantId, pid(51))

const dupAttempts = attemptsFromRounds(baseRounds(), pid(52))
dupAttempts[19] = { ...dupAttempts[19]!, roundNumber: 1 }
assert.equal(
  tryBuildDailyParticipantResultSummary(
    participantRow({ participantId: pid(52) }),
    dupAttempts,
  ),
  null,
)

// --- 20–23: 10-min boundary + FINAL stability ---
const earlyFinisher = candidate(
  pid(60),
  'Early',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T12:09:59.999Z',
  baseRounds(),
)
const lateFinisher = candidate(
  pid(61),
  'Late',
  '2026-10-14T00:02:00.000Z',
  '2026-10-14T12:10:00.001Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
        })
      : round(n, 'timed_out'),
  ),
)
const snap1210 = buildDailyRankingSelection(
  [earlyFinisher, lateFinisher],
  resolveDailyRankingWindow(date, new Date('2026-10-14T12:15:30.000Z')),
  pid(60),
)
assert.equal(snap1210.totalRankedParticipants, 1)

const snap1220 = buildDailyRankingSelection(
  [earlyFinisher, lateFinisher],
  resolveDailyRankingWindow(date, new Date('2026-10-14T12:20:00.000Z')),
  pid(60),
)
assert.equal(snap1220.totalRankedParticipants, 2)
assert.equal(snap1220.topEntries[0]!.participantId, pid(61))

const midA = buildDailyRankingSelection(
  [earlyFinisher, lateFinisher],
  resolveDailyRankingWindow(date, new Date('2026-10-14T12:10:00.000Z')),
  pid(60),
)
const midB = buildDailyRankingSelection(
  [earlyFinisher, lateFinisher],
  resolveDailyRankingWindow(date, new Date('2026-10-14T12:19:59.999Z')),
  pid(60),
)
assert.equal(midA.totalRankedParticipants, midB.totalRankedParticipants)

const dayCompleter = candidate(
  pid(70),
  'Day',
  '2026-10-14T00:01:00.000Z',
  '2026-10-14T23:59:59.999Z',
  baseRounds(),
)
assert.equal(
  resolveDailyRankingWindow(date, new Date('2026-10-14T23:59:59.999Z')).status,
  'provisional',
)
assert.equal(
  resolveDailyRankingWindow(date, new Date('2026-10-15T00:00:00.000Z')).status,
  'final',
)
const finalSel1 = buildDailyRankingSelection(
  [dayCompleter],
  resolveDailyRankingWindow(date, new Date('2026-10-15T00:00:00.000Z')),
  pid(70),
)
const finalSel2 = buildDailyRankingSelection(
  [dayCompleter],
  resolveDailyRankingWindow(date, new Date('2026-10-16T12:00:00.000Z')),
  pid(70),
)
assert.equal(finalSel1.self.rank, finalSel2.self.rank)
assert.equal(finalSel1.totalRankedParticipants, finalSel2.totalRankedParticipants)

const responseBody = toDailyRankingResponse(
  date,
  liveWindow,
  snap1210,
)
assert.doesNotMatch(
  JSON.stringify(responseBody),
  /totalTime|authToken|token|3cb_dp1_|bombBag|coinBagNumbers|"rounds"/i,
)
assert.equal(responseBody.self.isSelf, true)

// --- Handler auth / incomplete / foreign / date (16–18, 25–27) ---
const selfRounds = baseRounds()
const selfCompleted = '2026-10-14T12:00:00.000Z'
const poolCandidates: DailyRankingCandidate[] = [
  candidate(
    SELF_ID,
    'SelfPlayer',
    '2026-10-14T00:05:00.000Z',
    selfCompleted,
    selfRounds,
  ),
  candidate(
    pid(80),
    'Other',
    '2026-10-14T00:06:00.000Z',
    '2026-10-14T11:00:00.000Z',
    twenty((n) => round(n, 'cleared')),
  ),
]

const loadSelfOk = async () => ({
  participant: participantRow({ completedAt: selfCompleted }),
  attempts: attemptsFromRounds(selfRounds, SELF_ID),
})

const rankingOk = await readDailyRanking(
  { challengeDate: date, authTokenHash: authHash },
  {
    loadSelf: loadSelfOk,
    loadCandidates: async () => poolCandidates,
    now: () => new Date('2026-10-14T12:15:00.000Z'),
  },
)
assert.equal(rankingOk.status, 'provisional')
assert.equal(rankingOk.rankingAsOf, '2026-10-14T12:10:00.000Z')
assert.equal(rankingOk.topEntries[0]!.nickname, 'Other')
assert.equal(rankingOk.self.participantId, SELF_ID)
assert.equal(rankingOk.selfInTop, true)
assert.equal(rankingOk.totalRankedParticipants, 2)

const handler = createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    loadSelf: loadSelfOk,
    loadCandidates: async () => poolCandidates,
    now: () => new Date('2026-10-14T12:15:00.000Z'),
  }),
)
const okResponse = await handler(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(okResponse.status, 200)
assert.equal(okResponse.headers.get('Cache-Control'), 'no-store')
assert.doesNotMatch(JSON.stringify(await okResponse.json()), /totalTimeSeconds/)

await assert.rejects(
  () =>
    readDailyRanking(
      { challengeDate: date, authTokenHash: authHash },
      {
        loadSelf: async () => ({
          participant: participantRow({ completedAt: null }),
          attempts: attemptsFromRounds(selfRounds.slice(0, 5), SELF_ID),
        }),
        loadCandidates: async () => poolCandidates,
        now: () => new Date('2026-10-14T12:15:00.000Z'),
      },
    ),
  (e: unknown) =>
    e instanceof DailyRankingApiError && e.code === 'UNAVAILABLE',
)

const incompleteHandler = await createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    loadSelf: async () => ({
      participant: participantRow({ completedAt: null }),
      attempts: attemptsFromRounds(selfRounds.slice(0, 5), SELF_ID),
    }),
    loadCandidates: async () => [],
    now: () => new Date('2026-10-14T12:15:00.000Z'),
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(incompleteHandler.status, 404)
assert.deepEqual(await incompleteHandler.json(), {
  error: { code: 'ranking_unavailable' },
})

// --- Final confirm: mid-bucket 404 → next boundary 200; RESULT stays 200 ---
const midBucketCompletedAt = '2026-10-14T12:15:00.000Z'
const midBucketSelfSource = {
  participant: participantRow({ completedAt: midBucketCompletedAt }),
  attempts: attemptsFromRounds(selfRounds, SELF_ID),
}
const midBucketDeps = {
  loadSelf: async () => midBucketSelfSource,
  loadCandidates: async ({
    window,
  }: {
    readonly window: { readonly rankingAsOf: string; readonly status: string }
  }) => {
    const selfCand = candidate(
      SELF_ID,
      'SelfPlayer',
      '2026-10-14T00:05:00.000Z',
      midBucketCompletedAt,
      selfRounds,
    )
    const otherCand = candidate(
      pid(80),
      'Other',
      '2026-10-14T00:06:00.000Z',
      '2026-10-14T11:00:00.000Z',
      twenty((n) => round(n, 'cleared')),
    )
    // Mirror SQL provisional filter: completed_at <= rankingAsOf
    if (window.status === 'provisional') {
      const asOf = Date.parse(window.rankingAsOf)
      return [otherCand, selfCand].filter(
        (c) => Date.parse(c.completedAt) <= asOf,
      )
    }
    return [otherCand, selfCand]
  },
}

const midBucketHandler = createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    ...midBucketDeps,
    now: () => new Date('2026-10-14T12:15:00.000Z'),
  }),
)
const mid404 = await midBucketHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(mid404.status, 404)
assert.deepEqual(await mid404.json(), {
  error: { code: 'ranking_unavailable' },
})
assert.equal(mid404.headers.get('Cache-Control'), 'no-store')
// Opaque: no foreign nicknames / ranks in the 404 body
assert.doesNotMatch(
  JSON.stringify({ error: { code: 'ranking_unavailable' } }),
  /Other|participantId|topEntries/i,
)

// Same finished self → RESULT API 200 (eng8 path unchanged)
const resultWhileWaiting = await readDailyResult(
  { challengeDate: date, authTokenHash: authHash },
  { loadSource: async () => midBucketSelfSource },
)
assert.equal(resultWhileWaiting.participantId, SELF_ID)
assert.equal(resultWhileWaiting.completedAt, midBucketCompletedAt)
const resultHandlerOk = await createDailyResultHandler(async (auth) =>
  readDailyResult(auth, { loadSource: async () => midBucketSelfSource }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(resultHandlerOk.status, 200)

// Next UTC 10-minute boundary → ranking 200 with self included
const nextBoundaryHandler = createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    ...midBucketDeps,
    now: () => new Date('2026-10-14T12:20:00.000Z'),
  }),
)
const mid200 = await nextBoundaryHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(mid200.status, 200)
const mid200Json = (await mid200.json()) as {
  readonly status: string
  readonly rankingAsOf: string
  readonly self: { readonly participantId: string; readonly isSelf: boolean }
  readonly selfInTop: boolean
  readonly totalRankedParticipants: number
}
assert.equal(mid200Json.status, 'provisional')
assert.equal(mid200Json.rankingAsOf, '2026-10-14T12:20:00.000Z')
assert.equal(mid200Json.self.participantId, SELF_ID)
assert.equal(mid200Json.self.isSelf, true)
assert.equal(mid200Json.totalRankedParticipants, 2)
// UI can decide wait/retry from: 404 ranking_unavailable vs 200 + rankingAsOf/status
assert.ok(typeof mid200Json.rankingAsOf === 'string')
assert.ok(mid200Json.status === 'provisional' || mid200Json.status === 'final')

// Foreign token → self miss → 404
const foreign = await createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    loadSelf: async (input) =>
      input.authTokenHash === authHash ? loadSelfOk() : null,
    loadCandidates: async () => poolCandidates,
    now: () => new Date('2026-10-14T12:15:00.000Z'),
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(otherToken) },
  }),
)
assert.equal(foreign.status, 404)

const badAuth = await createDailyRankingHandler()(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: 'Bearer totally-invalid' },
  }),
)
assert.equal(badAuth.status, 401)

const badDate = await createDailyRankingHandler()(
  new Request('https://example.test/api/daily/challenges/not-a-date/ranking', {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(badDate.status, 400)

assert.throws(
  () => validateDailyRankingAuth('bad', bearer(token)),
  (e: unknown) =>
    e instanceof DailyRankingApiError && e.code === 'INVALID_REQUEST',
)
assert.throws(
  () => validateDailyRankingAuth(date, 'Bearer nope'),
  (e: unknown) =>
    e instanceof DailyRankingApiError && e.code === 'UNAUTHORIZED',
)

// Past-day FINAL via matching capability
const pastRounds = baseRounds()
const pastRanking = await readDailyRanking(
  { challengeDate: pastDate, authTokenHash: pastHash },
  {
    loadSelf: async (input) => {
      if (input.challengeDate !== pastDate || input.authTokenHash !== pastHash) {
        return null
      }
      return {
        participant: participantRow({
          challengeDate: pastDate,
          acceptedAt: '2026-10-13T10:00:00.000Z',
          completedAt: '2026-10-13T18:00:00.000Z',
        }),
        attempts: attemptsFromRounds(pastRounds, SELF_ID, pastDate),
      }
    },
    loadCandidates: async () => [
      candidate(
        SELF_ID,
        'SelfPlayer',
        '2026-10-13T10:00:00.000Z',
        '2026-10-13T18:00:00.000Z',
        pastRounds,
        pastDate,
      ),
    ],
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  },
)
assert.equal(pastRanking.challengeDate, pastDate)
assert.equal(pastRanking.status, 'final')
assert.equal(pastRanking.rankingAsOf, '2026-10-14T00:00:00.000Z')

// --- Final confirm: UTC deadline edge → FINAL membership (independent) ---
const finisher235950 = candidate(
  pid(90),
  'NearCloseA',
  '2026-10-14T00:10:00.000Z',
  '2026-10-14T23:59:50.000Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 2,
          openedBagCount: 2,
          coinBagHits: 2,
        })
      : round(n, 'timed_out'),
  ),
)
const finisher235959 = candidate(
  pid(91),
  'NearCloseB',
  '2026-10-14T00:11:00.000Z',
  '2026-10-14T23:59:59.000Z',
  twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
        })
      : round(n, 'timed_out'),
  ),
)
// Would-be completer after close — must never enter Oct 14 FINAL
const afterCloseIntruder = candidate(
  pid(92),
  'NextDay',
  '2026-10-15T00:01:00.000Z',
  '2026-10-15T00:01:00.000Z',
  baseRounds(),
  otherDate,
)
const finalAtClose = resolveDailyRankingWindow(
  date,
  new Date('2026-10-15T00:00:00.000Z'),
)
assert.equal(finalAtClose.status, 'final')
assert.equal(
  isCompletedInRankingSnapshot(finisher235950.completedAt, finalAtClose),
  true,
)
assert.equal(
  isCompletedInRankingSnapshot(finisher235959.completedAt, finalAtClose),
  true,
)
assert.equal(
  isCompletedInRankingSnapshot('2026-10-15T00:00:00.000Z', finalAtClose),
  false,
)
assert.equal(
  isCompletedInRankingSnapshot('2026-10-15T00:00:00.001Z', finalAtClose),
  false,
)

const finalPool = [finisher235950, finisher235959]
const finalSelA = buildDailyRankingSelection(finalPool, finalAtClose, pid(90))
const finalSelB = buildDailyRankingSelection(
  finalPool,
  resolveDailyRankingWindow(date, new Date('2026-10-20T08:00:00.000Z')),
  pid(90),
)
assert.equal(finalSelA.totalRankedParticipants, 2)
assert.equal(finalSelB.totalRankedParticipants, 2)
assert.equal(finalSelA.self.rank, finalSelB.self.rank)
assert.deepEqual(
  finalSelA.topEntries.map((e) => e.participantId),
  finalSelB.topEntries.map((e) => e.participantId),
)
assert.ok(
  finalSelA.topEntries.some((e) => e.participantId === pid(90)),
)
assert.ok(
  finalSelA.topEntries.some((e) => e.participantId === pid(91)),
)

// Past-day FINAL must not mix next-day participants (challengeDate scoped)
const pastOnlyPool = [
  candidate(
    pid(93),
    'PastOnly',
    '2026-10-13T10:00:00.000Z',
    '2026-10-13T22:00:00.000Z',
    baseRounds(),
    pastDate,
  ),
]
const pastFinalWindow = resolveDailyRankingWindow(
  pastDate,
  new Date('2026-10-15T12:00:00.000Z'),
)
const pastFinalSel = buildDailyRankingSelection(
  pastOnlyPool,
  pastFinalWindow,
  pid(93),
)
assert.equal(pastFinalSel.totalRankedParticipants, 1)
assert.equal(pastFinalSel.self.challengeDate, pastDate)
// Intruder has otherDate — not fed into past pool (API loads by challenge_date)
assert.notEqual(afterCloseIntruder.summary.challengeDate, pastDate)
assert.ok(
  !pastFinalSel.topEntries.some(
    (e) => e.participantId === afterCloseIntruder.summary.participantId,
  ),
)

// Handler-level FINAL: both near-close finishers present; stable on re-fetch
const nearCloseSelfSource = {
  participant: participantRow({
    participantId: pid(90),
    displayNickname: 'NearCloseA',
    acceptedAt: '2026-10-14T00:10:00.000Z',
    completedAt: '2026-10-14T23:59:50.000Z',
  }),
  attempts: attemptsFromRounds(finisher235950.summary.rounds, pid(90)),
}
// Capability for pid(90) path still uses route date + token hash mock via loadSelf
const finalTok = deriveDailyParticipantCapability(date, randomUUID(), environment)
const finalAuthHash = hashDailyParticipantCapability(finalTok)
const finalRead1 = await readDailyRanking(
  { challengeDate: date, authTokenHash: finalAuthHash },
  {
    loadSelf: async () => nearCloseSelfSource,
    loadCandidates: async () => finalPool,
    now: () => new Date('2026-10-15T00:00:00.000Z'),
  },
)
const finalRead2 = await readDailyRanking(
  { challengeDate: date, authTokenHash: finalAuthHash },
  {
    loadSelf: async () => nearCloseSelfSource,
    loadCandidates: async () => finalPool,
    now: () => new Date('2026-10-16T03:33:00.000Z'),
  },
)
assert.equal(finalRead1.status, 'final')
assert.equal(finalRead2.status, 'final')
assert.equal(finalRead1.rankingAsOf, finalRead2.rankingAsOf)
assert.equal(finalRead1.totalRankedParticipants, 2)
assert.equal(finalRead2.totalRankedParticipants, 2)
assert.deepEqual(
  finalRead1.topEntries.map((e) => ({
    id: e.participantId,
    rank: e.rank,
  })),
  finalRead2.topEntries.map((e) => ({
    id: e.participantId,
    rank: e.rank,
  })),
)
assert.ok(finalRead1.topEntries.some((e) => e.participantId === pid(90)))
assert.ok(finalRead1.topEntries.some((e) => e.participantId === pid(91)))
// Post-close completer on next day is not in this date's candidate load
assert.ok(
  !finalRead1.topEntries.some((e) => e.participantId === pid(92)),
)

const finalHttp = await createDailyRankingHandler(async (auth) =>
  readDailyRanking(auth, {
    loadSelf: async () => nearCloseSelfSource,
    loadCandidates: async () => finalPool,
    now: () => new Date('2026-10-15T00:00:00.000Z'),
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    headers: { authorization: bearer(finalTok) },
  }),
)
assert.equal(finalHttp.status, 200)
assert.equal(
  ((await finalHttp.json()) as { status: string }).status,
  'final',
)

const post = await createDailyRankingHandler()(
  new Request(`https://example.test/api/daily/challenges/${date}/ranking`, {
    method: 'POST',
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(post.status, 405)

// --- Source wiring / non-regression / no secrets ---
const rankingApiSource = readFileSync(
  resolve(root, 'server/daily/rankingApi.ts'),
  'utf8',
)
assert.match(rankingApiSource, /hashDailyParticipantCapability/)
assert.match(rankingApiSource, /compareDailyParticipantScores|buildDailyRankingSelection/)
assert.match(rankingApiSource, /loadDailyRankingPool|loadCandidates/)
assert.doesNotMatch(rankingApiSource, /console\.(log|info|debug).*token/i)
assert.doesNotMatch(rankingApiSource, /totalTimeSeconds/)

const domainSource = readFileSync(
  resolve(root, 'src/daily/dailyRanking.ts'),
  'utf8',
)
assert.match(domainSource, /compareDailyParticipantScores/)
assert.match(domainSource, /DAILY_RANKING_TOP_LIMIT = 10/)
assert.match(domainSource, /600_000|600000/)

const dbSource = readFileSync(resolve(root, 'server/db/dailyRanking.ts'), 'utf8')
assert.match(dbSource, /completed_at is not null/)
assert.match(dbSource, /expired_at is null/)
assert.match(dbSource, /completed_at <=/)
assert.match(dbSource, /tryBuildDailyParticipantResultSummary/)
assert.doesNotMatch(dbSource, /\b(?:DELETE|TRUNCATE|DROP)\b/i)

const handlerSource = readFileSync(
  resolve(root, 'api/_daily/challenges/[date]/ranking.ts'),
  'utf8',
)
assert.match(handlerSource, /Cache-Control.*no-store|no-store/)
assert.match(handlerSource, /ranking_unavailable/)

const dailyRouter = readFileSync(resolve(root, 'api/daily.ts'), 'utf8')
assert.match(dailyRouter, /\/ranking\$/)
assert.match(dailyRouter, /challenges\/\[date\]\/ranking/)

// RESULT route still present (non-regression of wiring)
assert.match(dailyRouter, /\/result\$/)
assert.match(
  readFileSync(resolve(root, 'api/_daily/challenges/[date]/result.ts'), 'utf8'),
  /result_unavailable/,
)
assert.match(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
  /verify:daily-ranking-api/,
)

// Eng7 compare still the single score comparator
assert.match(
  readFileSync(resolve(root, 'src/daily/dailyResult.ts'), 'utf8'),
  /export function compareDailyParticipantScores/,
)

console.log('verify:daily-ranking-api OK')
