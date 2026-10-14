/**
 * UTC 10-minute DAILY ranking auto-refresh helpers (eng9E).
 * Pure timing / decision logic — no I/O, no React.
 *
 * Snapshots advance only on worldwide UTC boundaries (:00/:10/:20/:30/:40/:50).
 * Never uses the participant's completion time as a refresh origin.
 */
import { DAILY_RANKING_BUCKET_MS } from './dailyRanking.js'

/** Small delay after a UTC boundary so server clocks / cold starts settle. */
export const DAILY_RANKING_BOUNDARY_SAFETY_MS = 1_500 as const

/** Limited retry when the response still carries a pre-boundary rankingAsOf. */
export const DAILY_RANKING_STALE_RETRY_MS = 3_000 as const

export const DAILY_RANKING_MAX_STALE_RETRIES = 2 as const

export type DailyRankingRefreshPhaseKind =
  | 'loading_self'
  | 'self_error'
  | 'ranking_loading'
  | 'ranking_pending'
  | 'ranking_error'
  | 'ready'

/**
 * Next exclusive UTC 10-minute boundary after `nowMs`.
 * Example: floor(now/600000)+1 * 600000
 */
export function nextDailyRankingBoundaryMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error('Invalid timestamp for DAILY ranking boundary.')
  }
  return (
    (Math.floor(nowMs / DAILY_RANKING_BUCKET_MS) + 1) * DAILY_RANKING_BUCKET_MS
  )
}

/** Current inclusive UTC bucket start (same as server floor). */
export function currentDailyRankingBucketMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error('Invalid timestamp for DAILY ranking bucket.')
  }
  return Math.floor(nowMs / DAILY_RANKING_BUCKET_MS) * DAILY_RANKING_BUCKET_MS
}

/**
 * Delay until the next scheduled auto-fetch: next boundary + safety margin.
 * Recomputed from `nowMs` every time (never a fixed 600000 interval).
 */
export function msUntilNextDailyRankingRefresh(
  nowMs: number,
  safetyMs: number = DAILY_RANKING_BOUNDARY_SAFETY_MS,
): number {
  const target = nextDailyRankingBoundaryMs(nowMs) + safetyMs
  return Math.max(0, target - nowMs)
}

/** Whether the RESULT screen should keep scheduling UTC ranking refreshes. */
export function shouldScheduleDailyRankingAutoRefresh(input: {
  readonly phaseKind: DailyRankingRefreshPhaseKind
  readonly rankingStatus?: 'provisional' | 'final'
  readonly rankingErrorCode?: 'unauthorized' | 'error'
  readonly selfErrorCode?: 'unauthorized' | 'error'
}): boolean {
  if (input.phaseKind === 'loading_self') return false
  if (input.phaseKind === 'self_error') return false
  if (input.phaseKind === 'ranking_loading') return false
  if (input.phaseKind === 'ranking_error') {
    return input.rankingErrorCode !== 'unauthorized'
  }
  if (input.phaseKind === 'ranking_pending') return true
  if (input.phaseKind === 'ready') {
    return input.rankingStatus === 'provisional'
  }
  return false
}

/**
 * True when a fetched rankingAsOf is not yet at/after the bucket we expect
 * after crossing a UTC boundary (clock skew / early request).
 */
export function isDailyRankingAsOfStale(input: {
  readonly rankingAsOfMs: number
  readonly expectedBucketMs: number
}): boolean {
  return input.rankingAsOfMs < input.expectedBucketMs
}

/**
 * After tab/sleep resume: fetch only if a UTC bucket boundary was crossed
 * since the last refresh attempt (or we never attempted while waiting).
 */
export function shouldRefreshDailyRankingOnResume(input: {
  readonly nowMs: number
  readonly lastAttemptMs: number | null
  readonly appliedRankingAsOfMs: number | null
  readonly phaseKind: DailyRankingRefreshPhaseKind
  readonly rankingStatus?: 'provisional' | 'final'
}): boolean {
  if (!shouldScheduleDailyRankingAutoRefresh({
    phaseKind: input.phaseKind,
    rankingStatus: input.rankingStatus,
  })) {
    return false
  }
  const nowBucket = currentDailyRankingBucketMs(input.nowMs)
  if (input.lastAttemptMs === null) {
    return (
      input.phaseKind === 'ranking_pending' ||
      input.phaseKind === 'ranking_error' ||
      input.phaseKind === 'ready'
    )
  }
  const lastAttemptBucket = currentDailyRankingBucketMs(input.lastAttemptMs)
  if (nowBucket > lastAttemptBucket) return true
  if (
    input.appliedRankingAsOfMs !== null &&
    nowBucket > input.appliedRankingAsOfMs
  ) {
    return true
  }
  return false
}

export type DailyRankingQuietRefreshDecision =
  | { readonly action: 'ignore' }
  | { readonly action: 'apply'; readonly stopAutoRefresh: boolean }
  | { readonly action: 'keep_pending' }
  | { readonly action: 'soft_error' }
  | { readonly action: 'hard_unauthorized' }
  | {
      readonly action: 'retry_stale'
      readonly retryAfterMs: number
      readonly retriesLeft: number
    }

/**
 * Decides how to apply a quiet ranking refresh result without wiping self scores.
 */
export function decideDailyRankingQuietRefresh(input: {
  readonly phaseKind: DailyRankingRefreshPhaseKind
  readonly appliedRankingAsOfMs: number | null
  /** Last successfully applied ranking status — blocks FINAL→provisional rollback. */
  readonly appliedRankingStatus?: 'provisional' | 'final' | null
  readonly response:
    | {
        readonly kind: 'ok'
        readonly challengeDate: string
        readonly expectedChallengeDate: string
        readonly rankingAsOfMs: number
        readonly status: 'provisional' | 'final'
        readonly selfParticipantId: string
        readonly expectedParticipantId: string
      }
    | {
        readonly kind: 'unavailable'
      }
    | {
        readonly kind: 'unauthorized'
      }
    | {
        readonly kind: 'error'
      }
  readonly expectedBucketMs: number
  readonly staleRetriesUsed: number
  readonly maxStaleRetries?: number
  readonly staleRetryMs?: number
}): DailyRankingQuietRefreshDecision {
  const maxStale = input.maxStaleRetries ?? DAILY_RANKING_MAX_STALE_RETRIES
  const staleMs = input.staleRetryMs ?? DAILY_RANKING_STALE_RETRY_MS

  if (input.response.kind === 'unauthorized') {
    return { action: 'hard_unauthorized' }
  }

  if (input.response.kind === 'unavailable') {
    if (
      input.phaseKind === 'ranking_pending' ||
      input.phaseKind === 'ranking_loading' ||
      input.phaseKind === 'ranking_error'
    ) {
      return { action: 'keep_pending' }
    }
    // Already showing a ranking — keep it; treat as soft fault only if unexpected.
    if (input.phaseKind === 'ready') return { action: 'soft_error' }
    return { action: 'ignore' }
  }

  if (input.response.kind === 'error') {
    if (input.phaseKind === 'ready') return { action: 'soft_error' }
    return { action: 'soft_error' }
  }

  const ok = input.response
  if (
    ok.challengeDate !== ok.expectedChallengeDate ||
    ok.selfParticipantId !== ok.expectedParticipantId
  ) {
    return { action: 'ignore' }
  }

  // Late/out-of-order provisional must never replace an applied FINAL.
  if (input.appliedRankingStatus === 'final' && ok.status === 'provisional') {
    return { action: 'ignore' }
  }

  if (
    isDailyRankingAsOfStale({
      rankingAsOfMs: ok.rankingAsOfMs,
      expectedBucketMs: input.expectedBucketMs,
    })
  ) {
    const used = input.staleRetriesUsed
    if (used < maxStale) {
      return {
        action: 'retry_stale',
        retryAfterMs: staleMs,
        retriesLeft: maxStale - used - 1,
      }
    }
    // Exhausted stale retries — still apply if newer than what we have, else soft wait.
    if (
      input.appliedRankingAsOfMs !== null &&
      ok.rankingAsOfMs <= input.appliedRankingAsOfMs
    ) {
      return { action: 'ignore' }
    }
  }

  if (
    input.appliedRankingAsOfMs !== null &&
    ok.rankingAsOfMs === input.appliedRankingAsOfMs &&
    input.phaseKind === 'ready'
  ) {
    return { action: 'ignore' }
  }

  if (
    input.appliedRankingAsOfMs !== null &&
    ok.rankingAsOfMs < input.appliedRankingAsOfMs
  ) {
    return { action: 'ignore' }
  }

  return {
    action: 'apply',
    stopAutoRefresh: ok.status === 'final',
  }
}

/** Completer-relative 10-minute cadence must never be used for scheduling. */
export function assertNotCompletionRelativeSchedule(input: {
  readonly completedAtMs: number
  readonly scheduledFireMs: number
  readonly nowMs: number
}): boolean {
  // Scheduled fire must align to worldwide boundary + safety, not completedAt+10m.
  const expected =
    nextDailyRankingBoundaryMs(input.nowMs) + DAILY_RANKING_BOUNDARY_SAFETY_MS
  if (input.scheduledFireMs !== expected) return false
  const completionRelative =
    input.completedAtMs + DAILY_RANKING_BUCKET_MS + DAILY_RANKING_BOUNDARY_SAFETY_MS
  return input.scheduledFireMs !== completionRelative
}
