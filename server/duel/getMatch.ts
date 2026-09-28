import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelMatchForParticipant,
  type GetDuelMatchInput,
  type PersistedDuelMatchView,
} from '../db/getDuelMatch.js'

export type GetDuelMatchErrorCode = 'MATCH_UNAVAILABLE'

export class GetDuelMatchError extends Error {
  readonly code: GetDuelMatchErrorCode

  constructor() {
    super('The DUEL match is unavailable.')
    this.name = 'GetDuelMatchError'
    this.code = 'MATCH_UNAVAILABLE'
  }
}

export interface GetDuelMatchRequest {
  readonly matchId: string
  readonly participantToken: string
}

export type GetDuelMatchResponse = PersistedDuelMatchView

export interface GetDuelMatchDependencies {
  readonly getMatch?: (
    input: GetDuelMatchInput,
  ) => Promise<PersistedDuelMatchView | null>
}

export function validateGetDuelMatchRequest(
  matchId: unknown,
  authorization: unknown,
): GetDuelMatchRequest {
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
    }
  } catch {
    throw new GetDuelMatchError()
  }
}

export async function getDuelMatch(
  request: GetDuelMatchRequest,
  dependencies: GetDuelMatchDependencies = {},
): Promise<GetDuelMatchResponse> {
  const getMatch = dependencies.getMatch ?? getDuelMatchForParticipant
  const match = await getMatch({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
  })
  if (!match) throw new GetDuelMatchError()
  return match
}
