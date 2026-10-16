/**
 * DAILY CHALLENGE ranking: competition ranks, Top-10 + self, UTC 10-minute
 * provisional snapshots and FINAL after challenge close.
 * Pure functions — no I/O.
 */
import { validateDailyChallengeDate } from './dailyChallengeDate.js'
import {
  compareDailyParticipantScores,
  type DailyParticipantResultSummary,
} from './dailyResult.js'

export const DAILY_RANKING_TOP_LIMIT = 10 as const
export const DAILY_RANKING_BUCKET_MS = 600_000 as const

export type DailyRankingStatus = 'provisional' | 'final'
export type DailyRankingSnapshotMode = 'scheduled' | 'immediate'

export interface DailyRankingWindow {
  readonly challengeDate: string
  readonly status: DailyRankingStatus
  /** Inclusive snapshot instant (UTC ISO). Completers with completedAt <= this are in-scope for provisional. */
  readonly rankingAsOf: string
  /** Exclusive UTC close of the challenge day (next midnight). */
  readonly challengeCloseAt: string
}

export interface DailyRankingCandidate {
  readonly summary: DailyParticipantResultSummary
  /** Server completion instant (UTC ISO). */
  readonly completedAt: string
}

export interface RankedDailyParticipant {
  readonly rank: number
  readonly participantId: string
  readonly displayNickname: string
  readonly challengeDate: string
  readonly acceptedAt: string
  readonly completedAt: string
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly coinBagHitRate: DailyParticipantResultSummary['coinBagHitRate']
  /** Retained for score compare / tests — never exposed on the ranking API. */
  readonly totalTimeSeconds: number
}

export interface DailyRankingSelection {
  readonly topEntries: readonly RankedDailyParticipant[]
  readonly self: RankedDailyParticipant
  readonly selfInTop: boolean
  readonly totalRankedParticipants: number
}

const MS_PER_DAY = 86_400_000

function assertIso(value: string, label: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw new Error(`Invalid ${label} for DAILY ranking.`)
  }
  return ms
}

/** UTC midnight at the start of `challengeDate`. */
export function dailyChallengeStartMs(challengeDate: string): number {
  const date = validateDailyChallengeDate(challengeDate)
  return assertIso(`${date}T00:00:00.000Z`, 'challenge start')
}

/** Exclusive UTC close: next day 00:00:00.000Z. */
export function dailyChallengeCloseMs(challengeDate: string): number {
  return dailyChallengeStartMs(challengeDate) + MS_PER_DAY
}

/**
 * UTC 10-minute bucket start: floor(unixMs / 600000) * 600000.
 * Ranking snapshots advance only on these boundaries.
 */
export function dailyRankingBucketStartMs(unixMs: number): number {
  if (!Number.isFinite(unixMs)) {
    throw new Error('Invalid timestamp for DAILY ranking bucket.')
  }
  return Math.floor(unixMs / DAILY_RANKING_BUCKET_MS) * DAILY_RANKING_BUCKET_MS
}

/**
 * Resolves provisional vs FINAL for a challenge date at server `now`.
 *
 * - Before challenge start → throws (caller maps to unavailable).
 * - During the UTC day → provisional; rankingAsOf = current 10-minute bucket start.
 * - At/after challenge close → final; rankingAsOf = challenge close instant.
 */
export function resolveDailyRankingWindow(
  challengeDate: string,
  now: Date = new Date(),
  snapshotMode: DailyRankingSnapshotMode = 'scheduled',
): DailyRankingWindow {
  const date = validateDailyChallengeDate(challengeDate)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid timestamp for DAILY ranking window.')
  }
  const nowMs = now.getTime()
  const startMs = dailyChallengeStartMs(date)
  const closeMs = dailyChallengeCloseMs(date)
  const closeAt = new Date(closeMs).toISOString()

  if (nowMs < startMs) {
    throw new Error('DAILY ranking is not available before challenge start.')
  }

  if (nowMs >= closeMs) {
    return {
      challengeDate: date,
      status: 'final',
      rankingAsOf: closeAt,
      challengeCloseAt: closeAt,
    }
  }

  const rankingAsOfMs =
    snapshotMode === 'immediate'
      ? nowMs
      : Math.max(dailyRankingBucketStartMs(nowMs), startMs)
  return {
    challengeDate: date,
    status: 'provisional',
    rankingAsOf: new Date(rankingAsOfMs).toISOString(),
    challengeCloseAt: closeAt,
  }
}

/**
 * Inclusive snapshot membership.
 * Provisional: completedAt <= rankingAsOf.
 * Final: any completer for the day (DB already enforces completed_at < close).
 */
export function isCompletedInRankingSnapshot(
  completedAt: string,
  window: DailyRankingWindow,
): boolean {
  const completedMs = assertIso(completedAt, 'completedAt')
  if (window.status === 'final') {
    const closeMs = assertIso(window.challengeCloseAt, 'challengeCloseAt')
    return completedMs < closeMs
  }
  const asOfMs = assertIso(window.rankingAsOf, 'rankingAsOf')
  return completedMs <= asOfMs
}

function compareDisplayOrder(
  a: DailyRankingCandidate,
  b: DailyRankingCandidate,
): number {
  const scoreOrder = compareDailyParticipantScores(a.summary, b.summary)
  if (scoreOrder !== 0) return scoreOrder
  const acceptedOrder =
    Date.parse(a.summary.acceptedAt) - Date.parse(b.summary.acceptedAt)
  if (acceptedOrder !== 0) return acceptedOrder
  return a.summary.participantId < b.summary.participantId
    ? -1
    : a.summary.participantId > b.summary.participantId
      ? 1
      : 0
}

function toRanked(
  candidate: DailyRankingCandidate,
  rank: number,
): RankedDailyParticipant {
  const { summary } = candidate
  return {
    rank,
    participantId: summary.participantId,
    displayNickname: summary.displayNickname,
    challengeDate: summary.challengeDate,
    acceptedAt: summary.acceptedAt,
    completedAt: candidate.completedAt,
    totalCoins: summary.totalCoins,
    threeCoinsComplete: summary.threeCoinsComplete,
    coinBagHits: summary.coinBagHits,
    totalOpens: summary.totalOpens,
    coinBagHitRate: summary.coinBagHitRate,
    totalTimeSeconds: summary.totalTimeSeconds,
  }
}

/**
 * Competition ranking (1, 1, 3). Display order uses acceptedAt then participantId
 * without changing equal ranks.
 */
export function rankDailyParticipants(
  values: readonly DailyRankingCandidate[],
): readonly RankedDailyParticipant[] {
  const sorted = [...values].sort(compareDisplayOrder)
  let previous: DailyRankingCandidate | null = null
  let previousRank = 0
  return sorted.map((candidate, index) => {
    const rank =
      previous &&
      compareDailyParticipantScores(previous.summary, candidate.summary) === 0
        ? previousRank
        : index + 1
    previous = candidate
    previousRank = rank
    return toRanked(candidate, rank)
  })
}

/**
 * After full-field ranking: take the first TOP_LIMIT rows, attach self from the
 * full list (true global rank), and flag whether self already appears in top.
 */
export function selectDailyRankingTopAndSelf(
  ranked: readonly RankedDailyParticipant[],
  selfParticipantId: string,
): DailyRankingSelection {
  if (ranked.length === 0) {
    throw new Error('DAILY ranking requires at least one ranked participant.')
  }
  const self = ranked.find(
    (entry) => entry.participantId === selfParticipantId,
  )
  if (!self) {
    throw new Error('DAILY ranking self participant is missing from ranked set.')
  }
  const topEntries = ranked.slice(0, DAILY_RANKING_TOP_LIMIT)
  const selfInTop = topEntries.some(
    (entry) => entry.participantId === selfParticipantId,
  )
  return {
    topEntries,
    self,
    selfInTop,
    totalRankedParticipants: ranked.length,
  }
}

/** Filter candidates to the snapshot window, then rank and select Top-10 + self. */
export function buildDailyRankingSelection(
  candidates: readonly DailyRankingCandidate[],
  window: DailyRankingWindow,
  selfParticipantId: string,
): DailyRankingSelection {
  const inSnapshot = candidates.filter((candidate) =>
    isCompletedInRankingSnapshot(candidate.completedAt, window),
  )
  return selectDailyRankingTopAndSelf(
    rankDailyParticipants(inSnapshot),
    selfParticipantId,
  )
}
