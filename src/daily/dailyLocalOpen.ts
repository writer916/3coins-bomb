import { DAILY_CHALLENGE_ROUNDS } from './dailyQuestionSet'

export type DailyLocalOpenOutcome = 'empty' | 'coins' | 'bomb'

export interface DailyPlayPlacement {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface DailyLocalOpenResult {
  readonly outcome: DailyLocalOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

function invalid(): never {
  throw new Error('Invalid DAILY placement.')
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return invalid()
  }
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...keys].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    return invalid()
  }
}

/** Validates one play-order placement (strict DTO). */
export function validateDailyPlayPlacement(
  value: unknown,
  expectedRoundNumber?: number,
): DailyPlayPlacement {
  const placement = record(value)
  exactKeys(placement, [
    'roundNumber',
    'bagCount',
    'bombBagNumber',
    'coinBagNumbers',
  ])
  const roundNumber = integer(placement.roundNumber, 1, DAILY_CHALLENGE_ROUNDS)
  if (
    expectedRoundNumber !== undefined &&
    roundNumber !== expectedRoundNumber
  ) {
    return invalid()
  }
  const bagCount = integer(placement.bagCount, 3, 8)
  const bombBagNumber = integer(placement.bombBagNumber, 1, bagCount)
  if (
    !Array.isArray(placement.coinBagNumbers) ||
    placement.coinBagNumbers.length !== 3
  ) {
    return invalid()
  }
  const coins = placement.coinBagNumbers.map((coin) =>
    integer(coin, 1, bagCount),
  )
  if (
    coins.some((coin, index) => index > 0 && coin < coins[index - 1]!) ||
    coins.includes(bombBagNumber)
  ) {
    return invalid()
  }
  return {
    roundNumber,
    bagCount,
    bombBagNumber,
    coinBagNumbers: coins as [number, number, number],
  }
}

/**
 * Client-side OPEN preview for FX (server remains authoritative).
 * Mirrors GROUP judgeGroupBag without importing GROUP modules.
 */
export function judgeDailyBag(
  placementValue: unknown,
  bagNumberValue: number,
): DailyLocalOpenResult {
  const placement = validateDailyPlayPlacement(placementValue)
  const bagNumber = integer(bagNumberValue, 1, placement.bagCount)
  if (bagNumber === placement.bombBagNumber) {
    return { outcome: 'bomb', coinsFound: 0 }
  }
  const coinsFound = placement.coinBagNumbers.filter(
    (coinBagNumber) => coinBagNumber === bagNumber,
  ).length
  if (coinsFound === 0) return { outcome: 'empty', coinsFound: 0 }
  return {
    outcome: 'coins',
    coinsFound: coinsFound as 1 | 2 | 3,
  }
}

/** Compare optimistic local preview to authoritative OPEN result. */
export function sameDailyLocalAndServerOpen(
  local: DailyLocalOpenResult,
  server: {
    readonly outcome: DailyLocalOpenOutcome
    readonly coinsFound: number
  },
): boolean {
  return local.outcome === server.outcome && local.coinsFound === server.coinsFound
}
