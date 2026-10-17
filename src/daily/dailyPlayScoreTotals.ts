import type { DailyChallengeDate } from './dailyChallengeDate'
import type {
  DailyCashOutResult,
  DailyOpenResult,
  DailyPlayState,
  DailyPlayTerminalAttempt,
} from './dailyPlayClient'
import { DAILY_CHALLENGE_ROUNDS } from './dailyQuestionSet'

export type DailyPlayScoreTotals = {
  readonly challengeDate: DailyChallengeDate
  /** Last confirmed ROUND number already folded into the totals. */
  readonly appliedRoundNumber: number
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  /**
   * When false, UI must not present the numeric totals as confirmed
   * (e.g. mid-run resume without server aggregates).
   */
  readonly ready: boolean
}

const STORAGE_PREFIX = '3cb:daily:v1:play-score-totals:'

function storageKey(challengeDate: DailyChallengeDate): string {
  return `${STORAGE_PREFIX}${challengeDate}`
}

export function emptyDailyPlayScoreTotals(
  challengeDate: DailyChallengeDate,
): DailyPlayScoreTotals {
  return {
    challengeDate,
    appliedRoundNumber: 0,
    totalCoins: 0,
    threeCoinsComplete: 0,
    ready: false,
  }
}

function isStoredTotals(
  value: unknown,
  challengeDate: DailyChallengeDate,
): value is {
  readonly challengeDate: DailyChallengeDate
  readonly appliedRoundNumber: number
  readonly totalCoins: number
  readonly threeCoinsComplete: number
} {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.challengeDate === challengeDate &&
    Number.isInteger(record.appliedRoundNumber) &&
    (record.appliedRoundNumber as number) >= 0 &&
    (record.appliedRoundNumber as number) <= DAILY_CHALLENGE_ROUNDS &&
    Number.isInteger(record.totalCoins) &&
    (record.totalCoins as number) >= 0 &&
    (record.totalCoins as number) <= DAILY_CHALLENGE_ROUNDS * 3 &&
    Number.isInteger(record.threeCoinsComplete) &&
    (record.threeCoinsComplete as number) >= 0 &&
    (record.threeCoinsComplete as number) <= DAILY_CHALLENGE_ROUNDS
  )
}

export function readDailyPlayScoreTotals(
  challengeDate: DailyChallengeDate,
  storage: Pick<Storage, 'getItem'> | null | undefined,
): DailyPlayScoreTotals | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(storageKey(challengeDate))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredTotals(parsed, challengeDate)) return null
    return { ...parsed, ready: true }
  } catch {
    return null
  }
}

/** Persist off the OPEN critical path (idle / microtask). */
export function scheduleWriteDailyPlayScoreTotals(
  totals: DailyPlayScoreTotals,
  storage: Pick<Storage, 'setItem'> | null | undefined,
): void {
  if (!storage || !totals.ready) return
  const payload = JSON.stringify({
    challengeDate: totals.challengeDate,
    appliedRoundNumber: totals.appliedRoundNumber,
    totalCoins: totals.totalCoins,
    threeCoinsComplete: totals.threeCoinsComplete,
  })
  const write = () => {
    try {
      storage.setItem(storageKey(totals.challengeDate), payload)
    } catch {
      /* quota / private mode */
    }
  }
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => write(), { timeout: 1500 })
    return
  }
  queueMicrotask(write)
}

/**
 * Fold one server-confirmed terminal ROUND into running totals.
 * Ignores duplicates and non-sequential ROUND numbers (no invented history).
 */
export function applyConfirmedTerminalToTotals(
  totals: DailyPlayScoreTotals,
  terminal: Pick<
    DailyPlayTerminalAttempt,
    'roundNumber' | 'capturedCoins' | 'endReason'
  >,
): DailyPlayScoreTotals {
  if (terminal.roundNumber <= totals.appliedRoundNumber) return totals
  const baseReady = totals.ready || totals.appliedRoundNumber === 0
  if (!baseReady) return totals
  if (terminal.roundNumber !== totals.appliedRoundNumber + 1) return totals
  return {
    challengeDate: totals.challengeDate,
    appliedRoundNumber: terminal.roundNumber,
    totalCoins: totals.totalCoins + terminal.capturedCoins,
    threeCoinsComplete:
      terminal.endReason === 'cleared'
        ? totals.threeCoinsComplete + 1
        : totals.threeCoinsComplete,
    ready: true,
  }
}

export function totalsFromServerPlayState(
  state: Pick<
    DailyPlayState,
    'challengeDate' | 'completedRounds' | 'totalCoins' | 'threeCoinsComplete'
  >,
): DailyPlayScoreTotals {
  return {
    challengeDate: state.challengeDate,
    appliedRoundNumber: state.completedRounds,
    totalCoins: state.totalCoins,
    threeCoinsComplete: state.threeCoinsComplete,
    ready: true,
  }
}

/**
 * Prefer server play aggregates; keep a newer sequential local apply if the
 * client confirmed a ROUND the latest play DTO has not caught up to yet.
 */
export function mergeServerPlayTotals(
  prev: DailyPlayScoreTotals,
  state: Pick<
    DailyPlayState,
    'challengeDate' | 'completedRounds' | 'totalCoins' | 'threeCoinsComplete'
  >,
): DailyPlayScoreTotals {
  const server = totalsFromServerPlayState(state)
  if (state.challengeDate !== prev.challengeDate) return server
  if (prev.ready && prev.appliedRoundNumber > server.appliedRoundNumber) {
    return prev
  }
  return server
}

export function applyConfirmedOpenResultToTotals(
  totals: DailyPlayScoreTotals,
  result: Pick<
    DailyOpenResult,
    'roundNumber' | 'capturedCoins' | 'endReason' | 'roundEnded'
  >,
): DailyPlayScoreTotals {
  if (!result.roundEnded || result.endReason === null) return totals
  return applyConfirmedTerminalToTotals(totals, {
    roundNumber: result.roundNumber,
    capturedCoins: result.capturedCoins,
    endReason: result.endReason,
  })
}

export function applyConfirmedCashOutToTotals(
  totals: DailyPlayScoreTotals,
  result: Pick<DailyCashOutResult, 'roundNumber' | 'capturedCoins'>,
): DailyPlayScoreTotals {
  return applyConfirmedTerminalToTotals(totals, {
    roundNumber: result.roundNumber,
    capturedCoins: result.capturedCoins,
    endReason: 'cashed_out',
  })
}

/**
 * Bootstrap: server play aggregates are authoritative. Cache is only used when
 * it matches completedRounds and server fields are somehow absent.
 */
export function hydrateDailyPlayScoreTotals(input: {
  readonly play: Pick<
    DailyPlayState,
    | 'challengeDate'
    | 'completedRounds'
    | 'totalCoins'
    | 'threeCoinsComplete'
    | 'latestTerminalAttempt'
  >
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}): DailyPlayScoreTotals {
  const { play, storage } = input
  const server = totalsFromServerPlayState(play)
  scheduleWriteDailyPlayScoreTotals(server, storage)
  return server
}
