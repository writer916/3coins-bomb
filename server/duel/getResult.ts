import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelResultForParticipant,
  type GetDuelResultInput,
  type PersistedDuelResult,
} from '../db/getDuelResult.js'

export class GetDuelResultError extends Error {
  constructor() {
    super('The DUEL match is unavailable.')
    this.name = 'GetDuelResultError'
  }
}

export interface GetDuelResultRequest {
  readonly matchId: string
  readonly participantToken: string
}

export interface GetDuelResultDependencies {
  readonly getResult?: (
    input: GetDuelResultInput,
  ) => Promise<PersistedDuelResult | null>
}

export function validateGetDuelResultRequest(
  matchId: unknown,
  authorization: unknown,
): GetDuelResultRequest {
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
    }
  } catch {
    throw new GetDuelResultError()
  }
}

export async function getDuelResult(
  request: GetDuelResultRequest,
  dependencies: GetDuelResultDependencies = {},
): Promise<PersistedDuelResult> {
  const getResult = dependencies.getResult ?? getDuelResultForParticipant
  const result = await getResult({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
  })
  if (!result) throw new GetDuelResultError()
  return result
}
