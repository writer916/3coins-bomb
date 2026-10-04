import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelMatchDetailForParticipant,
  type GetDuelMatchDetailInput,
} from '../db/getDuelMatchDetail.js'
import type { PersistedDuelMatchDetail } from './duelMatchDetail.js'

export class GetDuelMatchDetailError extends Error {
  constructor() {
    super('The DUEL match is unavailable.')
    this.name = 'GetDuelMatchDetailError'
  }
}

export interface GetDuelMatchDetailRequest {
  readonly matchId: string
  readonly participantToken: string
}

export interface GetDuelMatchDetailDependencies {
  readonly getDetail?: (
    input: GetDuelMatchDetailInput,
  ) => Promise<PersistedDuelMatchDetail | null>
}

export function validateGetDuelMatchDetailRequest(
  matchId: unknown,
  authorization: unknown,
): GetDuelMatchDetailRequest {
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
    }
  } catch {
    throw new GetDuelMatchDetailError()
  }
}

export async function getDuelMatchDetail(
  request: GetDuelMatchDetailRequest,
  dependencies: GetDuelMatchDetailDependencies = {},
): Promise<PersistedDuelMatchDetail> {
  const getDetail = dependencies.getDetail ?? getDuelMatchDetailForParticipant
  const detail = await getDetail({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
  })
  if (!detail) throw new GetDuelMatchDetailError()
  return detail
}
