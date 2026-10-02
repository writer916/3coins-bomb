import {
  DUEL_ROUNDS_MAX,
  DUEL_ROUNDS_MIN,
} from '../game/duelPlacement'
import type { DuelPlayOutcome } from './duelPlayClient'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DuelOpponentPlacement {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface DuelOpponentPlacementSet {
  readonly matchId: string
  readonly role: 'A' | 'B'
  readonly totalRounds: number
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly placements: readonly DuelOpponentPlacement[]
}

export interface DuelLocalOpenResult {
  readonly outcome: DuelPlayOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

export class DuelOpponentPlacementsValidationError extends Error {
  constructor() {
    super('The DUEL opponent placements are invalid.')
    this.name = 'DuelOpponentPlacementsValidationError'
  }
}

function invalid(): never {
  throw new DuelOpponentPlacementsValidationError()
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    return invalid()
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return invalid()
  }
  return value as number
}

function parsePlacement(value: unknown, expectedRoundNumber?: number): DuelOpponentPlacement {
  const record = objectRecord(value)
  exactKeys(record, ['roundNumber', 'bagCount', 'bombBagNumber', 'coinBagNumbers'])
  const roundNumber = integer(record.roundNumber, 1, DUEL_ROUNDS_MAX)
  const bagCount = integer(record.bagCount, 3, 8)
  const bombBagNumber = integer(record.bombBagNumber, 1, bagCount)
  if (expectedRoundNumber !== undefined && roundNumber !== expectedRoundNumber) {
    return invalid()
  }
  if (!Array.isArray(record.coinBagNumbers) || record.coinBagNumbers.length !== 3) {
    return invalid()
  }
  const coins = record.coinBagNumbers.map((coin) => integer(coin, 1, bagCount))
  if (
    coins.some((coin, index) => index > 0 && coin < coins[index - 1]) ||
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

export function parseDuelOpponentPlacementSet(
  value: unknown,
  expectedMatchId: string,
): DuelOpponentPlacementSet {
  if (!UUID_V4_PATTERN.test(expectedMatchId)) return invalid()
  const expected = expectedMatchId.toLowerCase()
  const record = objectRecord(value)
  exactKeys(record, [
    'matchId',
    'role',
    'totalRounds',
    'formationVersion',
    'ruleVersion',
    'placements',
  ])
  if (
    typeof record.matchId !== 'string' ||
    !UUID_V4_PATTERN.test(record.matchId) ||
    record.matchId.toLowerCase() !== expected ||
    (record.role !== 'A' && record.role !== 'B')
  ) {
    return invalid()
  }
  const totalRounds = integer(record.totalRounds, DUEL_ROUNDS_MIN, DUEL_ROUNDS_MAX)
  const formationVersion = integer(record.formationVersion, 1, 32_767)
  const ruleVersion = integer(record.ruleVersion, 1, 32_767)
  if (!Array.isArray(record.placements) || record.placements.length !== totalRounds) {
    return invalid()
  }
  const placements = record.placements.map((placement, index) =>
    parsePlacement(placement, index + 1),
  )
  return {
    matchId: expected,
    role: record.role,
    totalRounds,
    formationVersion,
    ruleVersion,
    placements,
  }
}

export function judgeDuelOpponentBag(
  placementValue: DuelOpponentPlacement,
  bagNumberValue: number,
): DuelLocalOpenResult {
  const placement = parsePlacement(placementValue)
  const bagNumber = integer(bagNumberValue, 1, placement.bagCount)
  if (bagNumber === placement.bombBagNumber) {
    return { outcome: 'bomb', coinsFound: 0 }
  }
  const coinsFound = placement.coinBagNumbers.filter((coin) => coin === bagNumber).length
  if (coinsFound === 0) return { outcome: 'empty', coinsFound: 0 }
  return {
    outcome: 'coins',
    coinsFound: coinsFound as 1 | 2 | 3,
  }
}
