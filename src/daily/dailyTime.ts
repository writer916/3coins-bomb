import {
  type DailyChallengeDate,
  validateDailyChallengeDate,
} from './dailyChallengeDate.js'

export const DAILY_ROUND_LIMIT_SECONDS = 60
export const DAILY_ROUND_LIMIT_MS = DAILY_ROUND_LIMIT_SECONDS * 1000
export const DAILY_OPERATION_GRACE_SECONDS = 2
export const DAILY_OPERATION_GRACE_MS = DAILY_OPERATION_GRACE_SECONDS * 1000

export interface DailyChallengePeriod {
  readonly challengeDate: DailyChallengeDate
  readonly startsAtMs: number
  readonly endsAtMs: number
  readonly startsAt: string
  readonly endsAt: string
}

export interface FormattedDailyChallengePeriod {
  readonly challengeDate: DailyChallengeDate
  readonly timeZone: string
  readonly usedUtcFallback: boolean
  readonly startsAt: string
  readonly endsAt: string
}

export type DailyOperationTimingValidation =
  | {
      readonly accepted: true
      readonly elapsedSeconds: number
    }
  | {
      readonly accepted: false
      readonly reason:
        | 'invalid_timestamp'
        | 'invalid_remaining_seconds'
        | 'received_before_claimed_tap_window'
        | 'round_grace_exceeded'
        | 'challenge_ended'
    }

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requireFiniteTime(value: unknown): number {
  if (!finiteNumber(value)) throw new Error('Invalid DAILY timestamp.')
  return value
}

/** Remaining whole seconds for the fixed 60-second DAILY round. */
export function calculateDailyRemainingSeconds(
  deadlineMsValue: number,
  nowMsValue: number,
): number {
  const deadlineMs = requireFiniteTime(deadlineMsValue)
  const nowMs = requireFiniteTime(nowMsValue)
  const remainingMs = deadlineMs - nowMs
  if (remainingMs <= 0) return 0
  return Math.min(
    DAILY_ROUND_LIMIT_SECONDS,
    Math.ceil(remainingMs / 1000),
  )
}

/** A tap is timely precisely while the shared countdown is above zero. */
export function isDailyRoundTapTimely(
  deadlineMs: number,
  tapAtMs: number,
): boolean {
  return calculateDailyRemainingSeconds(deadlineMs, tapAtMs) > 0
}

/** Freezes normal terminal time from the integer shown when the tap occurred. */
export function dailyElapsedSecondsAtTap(remainingSeconds: unknown): number {
  if (
    typeof remainingSeconds !== 'number' ||
    !Number.isInteger(remainingSeconds) ||
    remainingSeconds < 1 ||
    remainingSeconds > DAILY_ROUND_LIMIT_SECONDS
  ) {
    throw new Error('Invalid DAILY remaining seconds.')
  }
  return DAILY_ROUND_LIMIT_SECONDS - remainingSeconds
}

/** TIME OUT always consumes the complete round allowance. */
export function dailyTimedOutElapsedSeconds(): number {
  return DAILY_ROUND_LIMIT_SECONDS
}

/** UI countdown reaches zero at started_at + 60s (not the DB finalize instant). */
export function dailyRoundUiDeadlineMs(startedAtMsValue: number): number {
  return requireFiniteTime(startedAtMsValue) + DAILY_ROUND_LIMIT_MS
}

/**
 * Irreversible TIME OUT may be written only after the round clock and the
 * two-second network grace have both elapsed. This is not extra play time:
 * taps must still claim a remainingSeconds > 0 window that began before the
 * UI deadline; grace only covers late delivery of that claim.
 */
export function dailyRoundTimeoutFinalizeAtMs(startedAtMsValue: number): number {
  return (
    requireFiniteTime(startedAtMsValue) +
    DAILY_ROUND_LIMIT_MS +
    DAILY_OPERATION_GRACE_MS
  )
}

/**
 * Whether an active attempt may be finalized as `timed_out`.
 * UTC challenge end has no grace and forces finalize so OPEN cannot race
 * after `challenge_ended` rejects further taps.
 */
export function canFinalizeDailyRoundTimeout(input: {
  readonly startedAtMs: number
  readonly nowMs: number
  readonly challengeEndsAtMs: number
}): boolean {
  if (
    !finiteNumber(input.startedAtMs) ||
    !finiteNumber(input.nowMs) ||
    !finiteNumber(input.challengeEndsAtMs)
  ) {
    return false
  }
  if (input.nowMs >= input.challengeEndsAtMs) return true
  return input.nowMs >= dailyRoundTimeoutFinalizeAtMs(input.startedAtMs)
}

/**
 * Estimates server epoch time from a server epoch/monotonic-clock anchor.
 * The caller controls how the anchor was obtained (for example an API response).
 */
export function estimateDailyServerNowMs(
  serverNowAtAnchorMsValue: number,
  monotonicAtAnchorMsValue: number,
  monotonicNowMsValue: number,
): number {
  const serverNowAtAnchorMs = requireFiniteTime(serverNowAtAnchorMsValue)
  const monotonicAtAnchorMs = requireFiniteTime(monotonicAtAnchorMsValue)
  const monotonicNowMs = requireFiniteTime(monotonicNowMsValue)
  if (monotonicNowMs < monotonicAtAnchorMs) {
    throw new Error('DAILY monotonic clock moved backwards.')
  }
  return serverNowAtAnchorMs + monotonicNowMs - monotonicAtAnchorMs
}

/** UTC challenge close is strict and deliberately has no round grace. */
export function isDailyOperationBeforeChallengeEnd(
  receivedAtMsValue: number,
  challengeEndsAtMsValue: number,
): boolean {
  const receivedAtMs = requireFiniteTime(receivedAtMsValue)
  const challengeEndsAtMs = requireFiniteTime(challengeEndsAtMsValue)
  return receivedAtMs < challengeEndsAtMs
}

/**
 * Performs the minimum server-side timing checks for a client tap claim.
 * A displayed value R belongs to the one-second interval beginning at
 * `startedAt + (60 - R)s`. Receipt may trail that interval by less than the
 * fixed two-second grace. UTC challenge close remains a separate strict limit.
 */
export function validateDailyOperationTiming(input: {
  readonly startedAtMs: number
  readonly receivedAtMs: number
  readonly remainingSecondsAtTap: unknown
  readonly challengeEndsAtMs?: number
}): DailyOperationTimingValidation {
  if (
    !finiteNumber(input.startedAtMs) ||
    !finiteNumber(input.receivedAtMs) ||
    (input.challengeEndsAtMs !== undefined &&
      !finiteNumber(input.challengeEndsAtMs))
  ) {
    return { accepted: false, reason: 'invalid_timestamp' }
  }

  let elapsedSeconds: number
  try {
    elapsedSeconds = dailyElapsedSecondsAtTap(input.remainingSecondsAtTap)
  } catch {
    return { accepted: false, reason: 'invalid_remaining_seconds' }
  }

  if (
    input.challengeEndsAtMs !== undefined &&
    !isDailyOperationBeforeChallengeEnd(
      input.receivedAtMs,
      input.challengeEndsAtMs,
    )
  ) {
    return { accepted: false, reason: 'challenge_ended' }
  }

  const claimedWindowStartsAtMs = input.startedAtMs + elapsedSeconds * 1000
  const claimedWindowEndsAtMs = claimedWindowStartsAtMs + 1000
  if (input.receivedAtMs < claimedWindowStartsAtMs) {
    return { accepted: false, reason: 'received_before_claimed_tap_window' }
  }
  if (
    input.receivedAtMs >=
    claimedWindowEndsAtMs + DAILY_OPERATION_GRACE_MS
  ) {
    return { accepted: false, reason: 'round_grace_exceeded' }
  }

  return { accepted: true, elapsedSeconds }
}

/** Exact UTC [00:00, next 00:00) interval for one challenge date. */
export function dailyChallengePeriod(
  challengeDateValue: unknown,
): DailyChallengePeriod {
  const challengeDate = validateDailyChallengeDate(challengeDateValue)
  const [year, month, day] = challengeDate.split('-').map(Number)
  const startsAtMs = Date.UTC(year!, month! - 1, day!)
  const endsAtMs = startsAtMs + 24 * 60 * 60 * 1000
  return {
    challengeDate,
    startsAtMs,
    endsAtMs,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  }
}

/** Validates an IANA zone supported by the runtime, falling back to UTC. */
export function resolveDailyTimeZone(timeZoneValue: unknown): {
  readonly timeZone: string
  readonly usedUtcFallback: boolean
} {
  if (typeof timeZoneValue !== 'string' || timeZoneValue.length === 0) {
    return { timeZone: 'UTC', usedUtcFallback: true }
  }
  try {
    const timeZone = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZoneValue,
    }).resolvedOptions().timeZone
    return { timeZone, usedUtcFallback: false }
  } catch {
    return { timeZone: 'UTC', usedUtcFallback: true }
  }
}

function formatInstantInTimeZone(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs))
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`
}

/** Stable local date-time strings for a UTC challenge interval. */
export function formatDailyChallengePeriod(
  challengeDateValue: unknown,
  timeZoneValue: unknown,
): FormattedDailyChallengePeriod {
  const period = dailyChallengePeriod(challengeDateValue)
  const zone = resolveDailyTimeZone(timeZoneValue)
  return {
    challengeDate: period.challengeDate,
    ...zone,
    startsAt: formatInstantInTimeZone(period.startsAtMs, zone.timeZone),
    endsAt: formatInstantInTimeZone(period.endsAtMs, zone.timeZone),
  }
}
