import { randomInt } from 'node:crypto'
import {
  deriveDailyParticipantCapability,
  deriveDailyQuestionOrder,
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import { validateCreateRequestId } from '../auth/duelTokens.js'
import {
  loadDailyParticipantByToken,
  persistDailyParticipant,
  type DailyParticipantRecord,
  type PersistDailyParticipantInput,
} from '../db/dailyParticipants.js'
import {
  createGroupNicknameKey,
  validateGroupNickname,
} from '../../src/group/groupDomain.js'
import {
  utcDailyChallengeDate,
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from '../../src/daily/dailyChallengeDate.js'
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import { getOrCreateDailyQuestionSet } from './getOrCreateDailyQuestionSet.js'

export type DailyParticipantErrorCode =
  | 'INVALID_REQUEST'
  | 'CHALLENGE_UNAVAILABLE'
  | 'QUESTION_SET_UNAVAILABLE'
  | 'JOIN_UNAVAILABLE'
  | 'PERSISTENCE_UNAVAILABLE'

export class DailyParticipantError extends Error {
  readonly code: DailyParticipantErrorCode

  constructor(code: DailyParticipantErrorCode) {
    super('The DAILY participant operation could not be completed.')
    this.name = 'DailyParticipantError'
    this.code = code
  }
}

export type DailyQuestionOrderRandom = (maxExclusive: number) => number

export function createDailyQuestionOrder(
  random: DailyQuestionOrderRandom = randomInt,
): readonly number[] {
  const order = Array.from(
    { length: DAILY_CHALLENGE_ROUNDS },
    (_, index) => index + 1,
  )
  for (let index = order.length - 1; index > 0; index -= 1) {
    const selected = random(index + 1)
    if (!Number.isInteger(selected) || selected < 0 || selected > index) {
      throw new DailyParticipantError('INVALID_REQUEST')
    }
    const value = order[index]!
    order[index] = order[selected]!
    order[selected] = value
  }
  return order
}

export interface RegisterDailyParticipantDependencies {
  readonly now?: Date
  readonly ensureQuestionSet?: typeof getOrCreateDailyQuestionSet
  readonly persist?: (
    input: PersistDailyParticipantInput,
  ) => Promise<DailyParticipantRecord | null>
  readonly environment?: NodeJS.ProcessEnv
}

export interface RegisteredDailyParticipant extends DailyParticipantRecord {
  readonly token: string
}

/** Server-only JOIN orchestration; no client-supplied date is accepted. */
export async function registerDailyParticipant(
  nicknameValue: unknown,
  joinRequestIdValue: unknown,
  dependencies: RegisterDailyParticipantDependencies = {},
): Promise<RegisteredDailyParticipant> {
  let challengeDate: DailyChallengeDate
  let displayNickname: string
  let nicknameKey: string
  let joinRequestId: string
  try {
    challengeDate = utcDailyChallengeDate(dependencies.now ?? new Date())
  } catch {
    throw new DailyParticipantError('CHALLENGE_UNAVAILABLE')
  }
  try {
    displayNickname = validateGroupNickname(nicknameValue)
    nicknameKey = createGroupNicknameKey(displayNickname)
    joinRequestId = validateCreateRequestId(joinRequestIdValue)
  } catch {
    throw new DailyParticipantError('INVALID_REQUEST')
  }
  const ensureQuestionSet =
    dependencies.ensureQuestionSet ?? getOrCreateDailyQuestionSet
  try {
    await ensureQuestionSet(challengeDate)
  } catch {
    throw new DailyParticipantError('QUESTION_SET_UNAVAILABLE')
  }
  let token: string
  let questionOrder: readonly number[]
  try {
    token = deriveDailyParticipantCapability(
      challengeDate,
      joinRequestId,
      dependencies.environment,
    )
    questionOrder = deriveDailyQuestionOrder(
      challengeDate,
      joinRequestId,
      dependencies.environment,
    )
  } catch {
    throw new DailyParticipantError('JOIN_UNAVAILABLE')
  }
  const persist = dependencies.persist ?? persistDailyParticipant
  try {
    const saved = await persist({
      challengeDate,
      displayNickname,
      nicknameKey,
      authTokenHash: hashDailyParticipantCapability(token),
      joinRequestId,
      questionOrder,
    })
    if (!saved) throw new DailyParticipantError('JOIN_UNAVAILABLE')
    return { ...saved, token }
  } catch (error) {
    if (error instanceof DailyParticipantError) throw error
    throw new DailyParticipantError('PERSISTENCE_UNAVAILABLE')
  }
}

export async function authenticateDailyParticipant(
  challengeDateValue: unknown,
  tokenValue: unknown,
  load: typeof loadDailyParticipantByToken = loadDailyParticipantByToken,
): Promise<DailyParticipantRecord | null> {
  try {
    const challengeDate: DailyChallengeDate =
      validateDailyChallengeDate(challengeDateValue)
    const token = validateDailyParticipantCapability(tokenValue)
    return await load({
      challengeDate,
      authTokenHash: hashDailyParticipantCapability(token),
    })
  } catch {
    return null
  }
}
