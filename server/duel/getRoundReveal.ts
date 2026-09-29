import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  getDuelRoundRevealForParticipant,
  type GetDuelRoundRevealInput,
  type PersistedDuelRoundReveal,
} from '../db/getDuelRoundReveal.js'

export type GetRoundRevealErrorCode = 'INVALID_REQUEST' | 'MATCH_UNAVAILABLE'

export class GetRoundRevealError extends Error {
  readonly code: GetRoundRevealErrorCode

  constructor(code: GetRoundRevealErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL ROUND REVEAL request is invalid.'
        : 'The DUEL match is unavailable.',
    )
    this.name = 'GetRoundRevealError'
    this.code = code
  }
}

export interface GetRoundRevealRequest {
  readonly matchId: string
  readonly participantToken: string
  readonly roundNumber: number
}

export type GetRoundRevealResponse = PersistedDuelRoundReveal

export interface GetRoundRevealDependencies {
  readonly getReveal?: (
    input: GetDuelRoundRevealInput,
  ) => Promise<PersistedDuelRoundReveal | null>
}

export function validateGetRoundRevealRequest(
  matchId: unknown,
  roundNumber: unknown,
  authorization: unknown,
): GetRoundRevealRequest {
  if (
    !Number.isInteger(roundNumber) ||
    (roundNumber as number) < 1 ||
    (roundNumber as number) > 20
  ) {
    throw new GetRoundRevealError('INVALID_REQUEST')
  }
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
      roundNumber: roundNumber as number,
    }
  } catch {
    throw new GetRoundRevealError('MATCH_UNAVAILABLE')
  }
}

export async function getRoundReveal(
  request: GetRoundRevealRequest,
  dependencies: GetRoundRevealDependencies = {},
): Promise<GetRoundRevealResponse> {
  const getReveal =
    dependencies.getReveal ?? getDuelRoundRevealForParticipant
  const reveal = await getReveal({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
    roundNumber: request.roundNumber,
  })
  if (!reveal) throw new GetRoundRevealError('MATCH_UNAVAILABLE')
  return reveal
}
