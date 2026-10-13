import {
  utcDailyChallengeDate,
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from '../../src/daily/dailyChallengeDate.js'
import type { DailyQuestionSet } from '../../src/daily/dailyQuestionSet.js'
import {
  loadDailyQuestionSet,
  persistOrLoadDailyQuestionSet,
} from '../db/dailyQuestionSet.js'
import {
  provideDailyQuestionRounds,
  type DailyQuestionRandomSource,
} from './provideDailyQuestionSet.js'

export class DailyQuestionSetError extends Error {
  constructor(message = 'The DAILY question set could not be resolved.') {
    super(message)
    this.name = 'DailyQuestionSetError'
  }
}

export interface GetOrCreateDailyQuestionSetDependencies {
  readonly provideRounds?: () => ReturnType<typeof provideDailyQuestionRounds>
  readonly persistOrLoad?: typeof persistOrLoadDailyQuestionSet
  readonly load?: typeof loadDailyQuestionSet
  readonly random?: DailyQuestionRandomSource
}

/**
 * Server-internal entry: resolve the world-common 20-question set for a UTC day.
 * Creates and stores the set on first access; concurrent writers converge on one.
 */
export async function getOrCreateDailyQuestionSet(
  challengeDateValue: DailyChallengeDate | undefined = undefined,
  dependencies: GetOrCreateDailyQuestionSetDependencies = {},
): Promise<DailyQuestionSet> {
  let challengeDate: DailyChallengeDate
  try {
    challengeDate =
      challengeDateValue === undefined
        ? utcDailyChallengeDate()
        : validateDailyChallengeDate(challengeDateValue)
  } catch {
    throw new DailyQuestionSetError('Invalid DAILY challenge date.')
  }

  const load = dependencies.load ?? loadDailyQuestionSet
  const existing = await load(challengeDate)
  if (existing) return existing

  const provide =
    dependencies.provideRounds ??
    (() => provideDailyQuestionRounds(dependencies.random))
  const rounds = provide()
  const persist = dependencies.persistOrLoad ?? persistOrLoadDailyQuestionSet
  try {
    return await persist({ challengeDate, rounds })
  } catch (error: unknown) {
    const recovered = await load(challengeDate)
    if (recovered) return recovered
    if (error instanceof Error) throw new DailyQuestionSetError(error.message)
    throw new DailyQuestionSetError()
  }
}
