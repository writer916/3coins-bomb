import {
  QUESTION_SET_MAX_ROUNDS,
  normalizeQuestionPlacement,
  questionPlacementKey,
  type QuestionPlacement,
} from '../game/questionGeneration.js'
import type { DailyChallengeDate } from './dailyChallengeDate.js'
import { validateDailyChallengeDate } from './dailyChallengeDate.js'

export const DAILY_CHALLENGE_ROUNDS = QUESTION_SET_MAX_ROUNDS
export const DAILY_FORMATION_VERSION = 1
export const DAILY_RULE_VERSION = 1

export type DailyQuestionRound = QuestionPlacement & {
  readonly roundNumber: number
}

export interface DailyQuestionSet {
  readonly challengeDate: DailyChallengeDate
  readonly createdAt: string
  readonly created: boolean
  readonly formationVersion: typeof DAILY_FORMATION_VERSION
  readonly ruleVersion: typeof DAILY_RULE_VERSION
  readonly rounds: readonly DailyQuestionRound[]
}

function invalid(): never {
  throw new Error('Invalid DAILY question set.')
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return invalid()
  }
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

export function validateDailyQuestionRound(
  value: unknown,
  expectedRoundNumber: number,
): DailyQuestionRound {
  const round = record(value)
  const roundNumber = integer(round.roundNumber, 1, DAILY_CHALLENGE_ROUNDS)
  if (roundNumber !== expectedRoundNumber) return invalid()
  let placement: QuestionPlacement
  try {
    placement = normalizeQuestionPlacement({
      bagCount: round.bagCount as QuestionPlacement['bagCount'],
      bombBagNumber: round.bombBagNumber as number,
      coinBagNumbers: round.coinBagNumbers as QuestionPlacement['coinBagNumbers'],
    })
  } catch {
    return invalid()
  }
  return {
    roundNumber,
    bagCount: placement.bagCount,
    bombBagNumber: placement.bombBagNumber,
    coinBagNumbers: placement.coinBagNumbers,
  }
}

/**
 * Validates a persisted or freshly generated DAILY set: exactly 20 legal
 * ROUND placements with no duplicate configuration inside the day.
 */
export function validateDailyQuestionRounds(
  values: unknown,
): readonly DailyQuestionRound[] {
  if (!Array.isArray(values) || values.length !== DAILY_CHALLENGE_ROUNDS) {
    return invalid()
  }
  const rounds = values.map((value, index) =>
    validateDailyQuestionRound(value, index + 1),
  )
  const keys = new Set(rounds.map((round) => questionPlacementKey(round)))
  if (keys.size !== DAILY_CHALLENGE_ROUNDS) return invalid()
  return rounds
}

export function validateDailyQuestionSet(value: unknown): DailyQuestionSet {
  const set = record(value)
  const challengeDate = validateDailyChallengeDate(set.challengeDate)
  if (typeof set.createdAt !== 'string' || !Number.isFinite(Date.parse(set.createdAt))) {
    return invalid()
  }
  if (typeof set.created !== 'boolean') return invalid()
  if (set.formationVersion !== DAILY_FORMATION_VERSION) return invalid()
  if (set.ruleVersion !== DAILY_RULE_VERSION) return invalid()
  return {
    challengeDate,
    createdAt: new Date(set.createdAt).toISOString(),
    created: set.created,
    formationVersion: DAILY_FORMATION_VERSION,
    ruleVersion: DAILY_RULE_VERSION,
    rounds: validateDailyQuestionRounds(set.rounds),
  }
}

export function dailyQuestionRoundsFromPlacements(
  placements: readonly QuestionPlacement[],
): readonly DailyQuestionRound[] {
  return validateDailyQuestionRounds(
    placements.map((placement, index) => ({
      roundNumber: index + 1,
      bagCount: placement.bagCount,
      bombBagNumber: placement.bombBagNumber,
      coinBagNumbers: placement.coinBagNumbers,
    })),
  )
}
