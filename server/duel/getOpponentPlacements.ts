import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelOpponentPlacementsForParticipant,
  type GetDuelOpponentPlacementsInput,
  type PersistedDuelOpponentPlacements,
} from '../db/getDuelOpponentPlacements.js'

export class GetOpponentPlacementsError extends Error {
  readonly code = 'MATCH_UNAVAILABLE' as const

  constructor() {
    super('The DUEL match is unavailable.')
    this.name = 'GetOpponentPlacementsError'
  }
}

export interface GetOpponentPlacementsRequest {
  readonly matchId: string
  readonly participantToken: string
}

export type GetOpponentPlacementsResponse = PersistedDuelOpponentPlacements

export interface GetOpponentPlacementsDependencies {
  readonly getPlacements?: (
    input: GetDuelOpponentPlacementsInput,
  ) => Promise<PersistedDuelOpponentPlacements | null>
}

export function validateGetOpponentPlacementsRequest(
  matchId: unknown,
  authorization: unknown,
): GetOpponentPlacementsRequest {
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
    }
  } catch {
    throw new GetOpponentPlacementsError()
  }
}

export async function getOpponentPlacements(
  request: GetOpponentPlacementsRequest,
  dependencies: GetOpponentPlacementsDependencies = {},
): Promise<GetOpponentPlacementsResponse> {
  const getPlacements =
    dependencies.getPlacements ?? getDuelOpponentPlacementsForParticipant
  const placements = await getPlacements({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
  })
  if (!placements) throw new GetOpponentPlacementsError()
  return placements
}
