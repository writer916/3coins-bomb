import {
  DAILY_CHALLENGE_ROUNDS,
  DAILY_FORMATION_VERSION,
  DAILY_RULE_VERSION,
  type DailyQuestionRound,
} from '../../src/daily/dailyQuestionSet.js'
import {
  getDailyPlacementsForParticipant,
  type PersistedDailyPlacementSet,
} from '../db/dailyPlacements.js'
import {
  DailyPlayApiError,
  validateDailyPlayAuth,
  type DailyPlayAuth,
} from './playApi.js'

export { DailyPlayApiError, validateDailyPlayAuth }

/** HTTP-safe placement DTO — play-order only; never question_order or tokens. */
export interface DailyPlacementView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface DailyPlacementsResponse {
  readonly challengeDate: string
  readonly formationVersion: typeof DAILY_FORMATION_VERSION
  readonly ruleVersion: typeof DAILY_RULE_VERSION
  readonly placements: readonly DailyPlacementView[]
}

export interface DailyPlacementsApiDependencies {
  readonly getPlacements?: typeof getDailyPlacementsForParticipant
}

export function toDailyPlacementsResponse(
  value: PersistedDailyPlacementSet,
): DailyPlacementsResponse {
  if (
    value.placements.length !== DAILY_CHALLENGE_ROUNDS ||
    value.formationVersion !== DAILY_FORMATION_VERSION ||
    value.ruleVersion !== DAILY_RULE_VERSION
  ) {
    throw new DailyPlayApiError('NOT_FOUND')
  }
  return {
    challengeDate: value.challengeDate,
    formationVersion: DAILY_FORMATION_VERSION,
    ruleVersion: DAILY_RULE_VERSION,
    placements: value.placements.map((round: DailyQuestionRound) => ({
      roundNumber: round.roundNumber,
      bagCount: round.bagCount,
      bombBagNumber: round.bombBagNumber,
      coinBagNumbers: [
        round.coinBagNumbers[0],
        round.coinBagNumbers[1],
        round.coinBagNumbers[2],
      ] as [number, number, number],
    })),
  }
}

/**
 * Loads remapped placements for a joined participant.
 * START is not required — JOIN (capability × date) is enough, matching GROUP.
 */
export async function readDailyPlacements(
  auth: DailyPlayAuth,
  dependencies: DailyPlacementsApiDependencies = {},
): Promise<DailyPlacementsResponse> {
  const value = await (dependencies.getPlacements ??
    getDailyPlacementsForParticipant)({
    challengeDate: auth.challengeDate,
    authTokenHash: auth.authTokenHash,
  })
  if (!value || value.challengeDate !== auth.challengeDate) {
    throw new DailyPlayApiError('NOT_FOUND')
  }
  return toDailyPlacementsResponse(value)
}
