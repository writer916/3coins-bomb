import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import {
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import {
  authenticateDailyParticipant,
  registerDailyParticipant,
  type RegisteredDailyParticipant,
} from './dailyParticipant.js'
import { validateDailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { validateGroupNickname } from '../../src/group/groupDomain.js'

export const DAILY_JOIN_BODY_MAX_BYTES = 512

export class DailyParticipantApiError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'NOT_FOUND'

  constructor(code: DailyParticipantApiError['code']) {
    super('The DAILY participant request is unavailable.')
    this.name = 'DailyParticipantApiError'
    this.code = code
  }
}

function invalid(): never {
  throw new DailyParticipantApiError('INVALID_REQUEST')
}

export interface DailyJoinRequest {
  readonly nickname: string
  readonly joinRequestId: string
}

export function validateDailyJoinRequest(value: unknown): DailyJoinRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'joinRequestId' ||
    keys[1] !== 'nickname'
  ) {
    return invalid()
  }
  try {
    return {
      nickname: validateGroupNickname(record.nickname),
      joinRequestId: validateCreateRequestId(record.joinRequestId),
    }
  } catch {
    return invalid()
  }
}

export interface DailyJoinResponse {
  readonly challengeDate: string
  readonly participantId: string
  readonly nickname: string
  readonly token: string
  readonly acceptedAt: string
}

export async function joinCurrentDailyChallenge(
  input: DailyJoinRequest,
  register: typeof registerDailyParticipant = registerDailyParticipant,
): Promise<DailyJoinResponse> {
  const participant: RegisteredDailyParticipant = await register(
    input.nickname,
    input.joinRequestId,
  )
  return {
    challengeDate: participant.challengeDate,
    participantId: participant.participantId,
    nickname: participant.displayNickname,
    token: participant.token,
    acceptedAt: participant.acceptedAt,
  }
}

export interface DailyParticipantResponse {
  readonly challengeDate: string
  readonly participantId: string
  readonly nickname: string
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

export async function getDailyParticipant(
  dateValue: unknown,
  authorization: unknown,
  authenticate: typeof authenticateDailyParticipant =
    authenticateDailyParticipant,
): Promise<DailyParticipantResponse> {
  let challengeDate: string
  let token: string
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyParticipantApiError('INVALID_REQUEST')
  }
  try {
    token = validateDailyParticipantCapability(
      parseBearerToken(authorization),
    )
  } catch {
    throw new DailyParticipantApiError('UNAUTHORIZED')
  }
  const participant = await authenticate(challengeDate, token)
  if (!participant) throw new DailyParticipantApiError('NOT_FOUND')
  return {
    challengeDate: participant.challengeDate,
    participantId: participant.participantId,
    nickname: participant.displayNickname,
    acceptedAt: participant.acceptedAt,
    completedAt: participant.completedAt,
    expiredAt: participant.expiredAt,
  }
}
