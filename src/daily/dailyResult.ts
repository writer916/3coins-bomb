/**
 * DAILY CHALLENGE finished-score aggregation (RESULT / RANKING foundation).
 * Pure functions — no I/O. Ranking list assignment is a later engineering step.
 */
import { DAILY_CHALLENGE_ROUNDS } from './dailyQuestionSet.js'
import { DAILY_ROUND_LIMIT_SECONDS } from './dailyTime.js'

export const DAILY_SCORING_VERSION = 1 as const

export type DailyTerminalEndReason =
  | 'bombed'
  | 'cashed_out'
  | 'cleared'
  | 'timed_out'

export interface DailyRoundResultInput {
  readonly roundNumber: number
  readonly endReason: DailyTerminalEndReason
  readonly capturedCoins: number
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly elapsedSeconds: number
}

export interface DailyParticipantResultInput {
  readonly participantId: string
  readonly displayNickname: string
  readonly challengeDate: string
  readonly acceptedAt: string
  readonly rounds: readonly DailyRoundResultInput[]
}

export interface DailyRoundResultSummary {
  readonly roundNumber: number
  readonly endReason: DailyTerminalEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly elapsedSeconds: number
}

export interface DailyCoinBagHitRate {
  /** Sum of coin_bag_hits across finished ROUNDs (bags with ≥1 coin opened). */
  readonly numerator: number
  /** Sum of opened_bag_count across finished ROUNDs. */
  readonly denominator: number
}

export interface DailyParticipantResultSummary {
  readonly scoringVersion: typeof DAILY_SCORING_VERSION
  readonly participantId: string
  readonly displayNickname: string
  readonly challengeDate: string
  readonly acceptedAt: string
  /** TOTAL COINS — sum of per-ROUND captured coins. */
  readonly totalCoins: number
  /** 3COINS COMPLETE — count of cleared ROUNDs only. */
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly coinBagHitRate: DailyCoinBagHitRate
  /** TOTAL TIME — sum of per-ROUND elapsed_seconds. */
  readonly totalTimeSeconds: number
  readonly rounds: readonly DailyRoundResultSummary[]
}

export type DailyParticipantResultFailureReason =
  | 'incomplete_rounds'
  | 'invalid_round_set'
  | 'invalid_round'
  | 'invalid_participant'

export class DailyResultValidationError extends Error {
  readonly code: DailyParticipantResultFailureReason

  constructor(code: DailyParticipantResultFailureReason) {
    super('The DAILY result data is invalid or incomplete.')
    this.name = 'DailyResultValidationError'
    this.code = code
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHALLENGE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TERMINAL_REASONS = new Set<DailyTerminalEndReason>([
  'bombed',
  'cashed_out',
  'cleared',
  'timed_out',
])

function fail(code: DailyParticipantResultFailureReason): never {
  throw new DailyResultValidationError(code)
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return fail('invalid_round')
  }
  return value
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return fail('invalid_participant')
  }
  return value.toLowerCase()
}

function iso(value: unknown): string {
  if (typeof value !== 'string') return fail('invalid_participant')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return fail('invalid_participant')
  }
  return value
}

function challengeDate(value: unknown): string {
  if (typeof value !== 'string' || !CHALLENGE_DATE_PATTERN.test(value)) {
    return fail('invalid_participant')
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return fail('invalid_participant')
  if (new Date(parsed).toISOString().slice(0, 10) !== value) {
    return fail('invalid_participant')
  }
  return value
}

function nickname(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
    return fail('invalid_participant')
  }
  return value
}

function endReason(value: unknown): DailyTerminalEndReason {
  if (typeof value !== 'string' || !TERMINAL_REASONS.has(value as DailyTerminalEndReason)) {
    return fail('invalid_round')
  }
  return value as DailyTerminalEndReason
}

/**
 * Validates one finished ROUND against DAILY attempt constraints
 * (mirrors daily_attempts_state_check for terminal rows).
 */
export function validateDailyTerminalRound(
  round: DailyRoundResultInput,
  expectedRoundNumber: number,
): DailyRoundResultSummary {
  if (round.roundNumber !== expectedRoundNumber) return fail('invalid_round_set')
  const reason = endReason(round.endReason)
  const openedBagCount = integer(round.openedBagCount, 0, 8)
  const coinBagHits = integer(round.coinBagHits, 0, openedBagCount)
  const capturedCoins = integer(round.capturedCoins, 0, 3) as 0 | 1 | 2 | 3
  const elapsedSeconds = integer(round.elapsedSeconds, 0, DAILY_ROUND_LIMIT_SECONDS)

  if (reason === 'timed_out') {
    if (elapsedSeconds !== DAILY_ROUND_LIMIT_SECONDS || capturedCoins !== 0) {
      return fail('invalid_round')
    }
  } else if (reason === 'bombed') {
    if (
      elapsedSeconds > 59 ||
      capturedCoins !== 0 ||
      openedBagCount < 1
    ) {
      return fail('invalid_round')
    }
  } else if (reason === 'cashed_out') {
    if (
      elapsedSeconds > 59 ||
      (capturedCoins !== 1 && capturedCoins !== 2) ||
      openedBagCount < 1
    ) {
      return fail('invalid_round')
    }
  } else if (reason === 'cleared') {
    if (
      elapsedSeconds > 59 ||
      capturedCoins !== 3 ||
      openedBagCount < 1
    ) {
      return fail('invalid_round')
    }
  }

  return {
    roundNumber: expectedRoundNumber,
    endReason: reason,
    capturedCoins,
    openedBagCount,
    coinBagHits,
    elapsedSeconds,
  }
}

/**
 * True only when there are exactly 20 terminal ROUNDs numbered 1..20 with no gaps
 * or duplicates. Active / missing / extra rounds make a run unfinished.
 */
export function isCompleteDailyTerminalRoundSet(
  rounds: readonly DailyRoundResultInput[],
): boolean {
  if (!Array.isArray(rounds) || rounds.length !== DAILY_CHALLENGE_ROUNDS) {
    return false
  }
  const seen = new Set<number>()
  for (const round of rounds) {
    if (
      typeof round?.roundNumber !== 'number' ||
      !Number.isInteger(round.roundNumber) ||
      round.roundNumber < 1 ||
      round.roundNumber > DAILY_CHALLENGE_ROUNDS ||
      seen.has(round.roundNumber)
    ) {
      return false
    }
    if (
      typeof round.endReason !== 'string' ||
      !TERMINAL_REASONS.has(round.endReason as DailyTerminalEndReason)
    ) {
      return false
    }
    seen.add(round.roundNumber)
  }
  return seen.size === DAILY_CHALLENGE_ROUNDS
}

/**
 * Aggregates a finished 20-ROUND DAILY run into RESULT metrics.
 * Incomplete sets throw with code `incomplete_rounds`.
 */
export function aggregateDailyParticipantResult(
  input: DailyParticipantResultInput,
): DailyParticipantResultSummary {
  const participantId = uuid(input.participantId)
  const displayNickname = nickname(input.displayNickname)
  const date = challengeDate(input.challengeDate)
  const acceptedAt = iso(input.acceptedAt)

  if (!isCompleteDailyTerminalRoundSet(input.rounds)) {
    return fail('incomplete_rounds')
  }

  const byNumber = new Map<number, DailyRoundResultInput>()
  for (const round of input.rounds) {
    byNumber.set(round.roundNumber, round)
  }

  let totalCoins = 0
  let threeCoinsComplete = 0
  let coinBagHits = 0
  let totalOpens = 0
  let totalTimeSeconds = 0
  const rounds: DailyRoundResultSummary[] = []

  for (let roundNumber = 1; roundNumber <= DAILY_CHALLENGE_ROUNDS; roundNumber += 1) {
    const raw = byNumber.get(roundNumber)
    if (!raw) return fail('incomplete_rounds')
    const summary = validateDailyTerminalRound(raw, roundNumber)
    totalCoins += summary.capturedCoins
    if (summary.endReason === 'cleared') threeCoinsComplete += 1
    coinBagHits += summary.coinBagHits
    totalOpens += summary.openedBagCount
    totalTimeSeconds += summary.elapsedSeconds
    rounds.push(summary)
  }

  const maxCoins = DAILY_CHALLENGE_ROUNDS * 3
  const maxOpens = DAILY_CHALLENGE_ROUNDS * 8
  const maxTime = DAILY_CHALLENGE_ROUNDS * DAILY_ROUND_LIMIT_SECONDS
  if (
    !Number.isInteger(totalCoins) ||
    totalCoins < 0 ||
    totalCoins > maxCoins ||
    !Number.isInteger(threeCoinsComplete) ||
    threeCoinsComplete < 0 ||
    threeCoinsComplete > DAILY_CHALLENGE_ROUNDS ||
    !Number.isInteger(coinBagHits) ||
    coinBagHits < 0 ||
    coinBagHits > totalOpens ||
    !Number.isInteger(totalOpens) ||
    totalOpens < 0 ||
    totalOpens > maxOpens ||
    !Number.isInteger(totalTimeSeconds) ||
    totalTimeSeconds < 0 ||
    totalTimeSeconds > maxTime
  ) {
    return fail('invalid_round')
  }

  return {
    scoringVersion: DAILY_SCORING_VERSION,
    participantId,
    displayNickname,
    challengeDate: date,
    acceptedAt,
    totalCoins,
    threeCoinsComplete,
    coinBagHits,
    totalOpens,
    coinBagHitRate: { numerator: coinBagHits, denominator: totalOpens },
    totalTimeSeconds,
    rounds,
  }
}

export function tryAggregateDailyParticipantResult(
  input: DailyParticipantResultInput,
): DailyParticipantResultSummary | null {
  try {
    return aggregateDailyParticipantResult(input)
  } catch (error: unknown) {
    if (
      error instanceof DailyResultValidationError &&
      error.code === 'incomplete_rounds'
    ) {
      return null
    }
    throw error
  }
}

/**
 * Cross-multiply HIT RATE compare. Negative means `a` ranks ahead of `b`
 * (higher rate first).
 *
 * 0 OPEN (`denominator === 0`) is defined as 0% HIT RATE: hits are forced to 0
 * and the compare denominator is normalized to 1 so 0/0 ties with any other
 * zero rate (e.g. 0/5) and loses to any positive rate.
 */
export function compareDailyCoinBagHitRate(
  a: DailyCoinBagHitRate,
  b: DailyCoinBagHitRate,
): number {
  // Explicit zero-open normalization before cross-multiply.
  const aDenominator = a.denominator === 0 ? 1 : a.denominator
  const bDenominator = b.denominator === 0 ? 1 : b.denominator
  const aHits = a.denominator === 0 ? 0 : a.numerator
  const bHits = b.denominator === 0 ? 0 : b.numerator
  if (
    !Number.isInteger(aHits) ||
    !Number.isInteger(bHits) ||
    !Number.isInteger(aDenominator) ||
    !Number.isInteger(bDenominator) ||
    aHits < 0 ||
    bHits < 0 ||
    aDenominator < 1 ||
    bDenominator < 1
  ) {
    return fail('invalid_round')
  }
  const aProduct = aHits * bDenominator
  const bProduct = bHits * aDenominator
  return aProduct === bProduct ? 0 : aProduct > bProduct ? -1 : 1
}

function validateSummary(
  summary: DailyParticipantResultSummary,
): DailyParticipantResultSummary {
  if (summary.scoringVersion !== DAILY_SCORING_VERSION) return fail('invalid_round')
  uuid(summary.participantId)
  nickname(summary.displayNickname)
  challengeDate(summary.challengeDate)
  iso(summary.acceptedAt)
  if (
    summary.coinBagHitRate.numerator !== summary.coinBagHits ||
    summary.coinBagHitRate.denominator !== summary.totalOpens ||
    summary.rounds.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    return fail('invalid_round')
  }
  return summary
}

/**
 * Score-only comparison for RANKING (4 metrics).
 * Negative means `a` ranks ahead of `b`. Equal scores return 0 (same rank).
 * Display tie-break (acceptedAt / participantId) lives in `dailyRanking.ts`.
 */
export function compareDailyParticipantScores(
  aValue: DailyParticipantResultSummary,
  bValue: DailyParticipantResultSummary,
): number {
  const a = validateSummary(aValue)
  const b = validateSummary(bValue)
  if (a.totalCoins !== b.totalCoins) return b.totalCoins - a.totalCoins
  if (a.threeCoinsComplete !== b.threeCoinsComplete) {
    return b.threeCoinsComplete - a.threeCoinsComplete
  }
  const hitOrder = compareDailyCoinBagHitRate(a.coinBagHitRate, b.coinBagHitRate)
  if (hitOrder !== 0) return hitOrder
  if (a.totalTimeSeconds !== b.totalTimeSeconds) {
    return a.totalTimeSeconds - b.totalTimeSeconds
  }
  return 0
}
