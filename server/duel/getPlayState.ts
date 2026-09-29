import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelPlayStateForParticipant,
  type GetDuelPlayStateInput,
  type PersistedDuelPlayState,
} from '../db/getDuelPlayState.js'

export type GetPlayStateErrorCode = 'MATCH_UNAVAILABLE'

export class GetPlayStateError extends Error {
  readonly code: GetPlayStateErrorCode

  constructor() {
    super('The DUEL match is unavailable.')
    this.name = 'GetPlayStateError'
    this.code = 'MATCH_UNAVAILABLE'
  }
}

export interface GetPlayStateRequest {
  readonly matchId: string
  readonly participantToken: string
}

export type GetPlayStateResponse = PersistedDuelPlayState

export interface GetPlayStateDependencies {
  readonly getState?: (
    input: GetDuelPlayStateInput,
  ) => Promise<PersistedDuelPlayState | null>
}

export function validateGetPlayStateRequest(
  matchId: unknown,
  authorization: unknown,
): GetPlayStateRequest {
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
    }
  } catch {
    throw new GetPlayStateError()
  }
}

export async function getPlayState(
  request: GetPlayStateRequest,
  dependencies: GetPlayStateDependencies = {},
): Promise<GetPlayStateResponse> {
  const getState = dependencies.getState ?? getDuelPlayStateForParticipant
  const state = await getState({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
  })
  if (!state) throw new GetPlayStateError()
  return state
}
