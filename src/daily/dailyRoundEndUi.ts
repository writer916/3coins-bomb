import type { DailyPlayState } from './dailyPlayClient'

/** Player-facing ROUND end label (server may still store timed_out / 0 COINS). */
export type DailyDisplayEndKind =
  | 'timeout'
  | 'connection_error_end'
  | 'challenge_ended'

/**
 * Chooses the player-facing end reason after GET play shows no active ROUND.
 * Server scores stay authoritative; this only picks the label.
 *
 * UTC expiry (`expiredAt`) always wins so grace-exceeded ops are not shown as
 * a generic connection-error end when the challenge day has closed.
 */
export function resolveDailyDisplayEndKind(input: {
  readonly state: DailyPlayState
  /** True when this page still knows an in-time OPEN/CASH OUT was attempted. */
  readonly hadInTimePendingAction: boolean
}): DailyDisplayEndKind | null {
  if (input.state.activeAttempt) return null
  if (input.state.expiredAt) return 'challenge_ended'
  if (input.hadInTimePendingAction) return 'connection_error_end'
  return 'timeout'
}

export function hasInTimePendingAction(input: {
  readonly pendingOpenRemainingSeconds: number | null
  readonly pendingCashOutRemainingSeconds: number | null
}): boolean {
  const openR = input.pendingOpenRemainingSeconds
  const cashR = input.pendingCashOutRemainingSeconds
  return (
    (typeof openR === 'number' && openR >= 1 && openR <= 60) ||
    (typeof cashR === 'number' && cashR >= 1 && cashR <= 60)
  )
}

/** Backoff between automatic GET play checks after the UI clock hits 0. */
export function nextDailyStatusPollDelayMs(previousDelayMs: number): number {
  const min = 500
  const max = 15_000
  if (!Number.isFinite(previousDelayMs) || previousDelayMs < min) return min
  return Math.min(max, Math.max(min, Math.floor(previousDelayMs * 2)))
}

/** Automatic recovery is deliberately finite; later online/visible events may restart it. */
export const DAILY_RECOVERY_MAX_AUTOMATIC_RETRIES = 5

/** 0.5s, 1s, 2s, 4s, 8s between same-command recovery attempts. */
export function dailyRecoveryRetryDelayMs(attemptNumber: number): number {
  const safeAttempt = Number.isInteger(attemptNumber)
    ? Math.min(
        DAILY_RECOVERY_MAX_AUTOMATIC_RETRIES,
        Math.max(1, attemptNumber),
      )
    : 1
  return 500 * 2 ** (safeAttempt - 1)
}

export function canScheduleDailyRecoveryRetry(
  attemptsCompleted: number,
): boolean {
  return (
    Number.isInteger(attemptsCompleted) &&
    attemptsCompleted >= 0 &&
    attemptsCompleted < DAILY_RECOVERY_MAX_AUTOMATIC_RETRIES
  )
}

/** RESULT is available only after a server response/state confirms all rounds. */
export function canOpenDailyResult(input: {
  readonly completedAt: string | null
  readonly completedRounds: number
  readonly hasTerminal: boolean
  readonly terminalParticipantCompleted: boolean
}): boolean {
  return (
    input.completedAt !== null ||
    input.terminalParticipantCompleted ||
    (input.hasTerminal && input.completedRounds >= 20)
  )
}

/** Freeze the player-visible ROUND clock at the accepted terminal operation. */
export function dailyTerminalRemainingSeconds(
  terminal:
    | { readonly kind: 'open' | 'cash'; readonly remainingSecondsAtTap: number }
    | {
        readonly kind: 'timeout' | 'connection_error_end' | 'challenge_ended'
      },
): number {
  if (terminal.kind !== 'open' && terminal.kind !== 'cash') return 0
  if (!Number.isInteger(terminal.remainingSecondsAtTap)) return 0
  return Math.min(60, Math.max(0, terminal.remainingSecondsAtTap))
}

/**
 * When GET play has no active ROUND, pending in-time ops must be recovered
 * (idempotent retry) before any player-facing end label is chosen.
 */
export function classifyInactivePlaySync(input: {
  readonly hasActiveAttempt: boolean
  readonly hasInTimePendingAction: boolean
}): 'active' | 'defer_end_for_recovery' | 'classify_end' {
  if (input.hasActiveAttempt) return 'active'
  if (input.hasInTimePendingAction) return 'defer_end_for_recovery'
  return 'classify_end'
}

/** Drop GET play results that raced past cancel, ROUND advance, or a newer terminal. */
export function shouldDiscardStalePlaySync(input: {
  readonly cancelled: boolean
  readonly syncEpoch: number
  readonly currentEpoch: number
  readonly hasTerminal: boolean
}): boolean {
  return (
    input.cancelled ||
    input.syncEpoch !== input.currentEpoch ||
    input.hasTerminal
  )
}
