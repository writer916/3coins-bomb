import { generateUniqueQuestionSet } from '../../src/game/questionGeneration.js'
import {
  DAILY_CHALLENGE_ROUNDS,
  dailyQuestionRoundsFromPlacements,
  type DailyQuestionRound,
} from '../../src/daily/dailyQuestionSet.js'
import {
  createServerCryptoRandomSource,
  type GroupRandomSource,
} from '../group/groupPlacementProvider.js'

export type DailyQuestionRandomSource = GroupRandomSource

/** Builds a fresh 20-round DAILY set via the shared question engine. */
export function provideDailyQuestionRounds(
  random: DailyQuestionRandomSource = createServerCryptoRandomSource(),
): readonly DailyQuestionRound[] {
  return dailyQuestionRoundsFromPlacements(
    generateUniqueQuestionSet(DAILY_CHALLENGE_ROUNDS, random),
  )
}
