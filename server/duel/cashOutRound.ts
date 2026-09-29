import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  persistDuelRoundCashOut,
  type CashOutDuelRoundInput,
  type CashOutDuelRoundResult,
  type CashOutDuelRoundView,
} from '../db/cashOutDuelRound.js'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CashOutRoundErrorCode =
  | 'INVALID_REQUEST'
  | 'MATCH_UNAVAILABLE'
  | 'CASH_OUT_CONFLICT'

export class CashOutRoundError extends Error {
  readonly code: CashOutRoundErrorCode

  constructor(code: CashOutRoundErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL CASH OUT request is invalid.'
        : code === 'MATCH_UNAVAILABLE'
          ? 'The DUEL match is unavailable.'
          : 'The DUEL CASH OUT request conflicts with the current state.',
    )
    this.name = 'CashOutRoundError'
    this.code = code
  }
}

export interface CashOutRoundRequest {
  readonly matchId: string
  readonly participantToken: string
  readonly requestId: string
  readonly roundNumber: number
}

export type CashOutRoundResponse = CashOutDuelRoundView

export interface CashOutRoundDependencies {
  readonly persist?: (
    input: CashOutDuelRoundInput,
  ) => Promise<CashOutDuelRoundResult>
}

function invalidRequest(): never {
  throw new CashOutRoundError('INVALID_REQUEST')
}

export function validateCashOutRoundRequest(
  matchId: unknown,
  roundNumber: unknown,
  authorization: unknown,
  idempotencyKey: unknown,
): CashOutRoundRequest {
  if (
    !Number.isInteger(roundNumber) ||
    (roundNumber as number) < 1 ||
    (roundNumber as number) > 20 ||
    typeof idempotencyKey !== 'string' ||
    !UUID_V4_PATTERN.test(idempotencyKey)
  ) {
    return invalidRequest()
  }
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
      requestId: idempotencyKey.toLowerCase(),
      roundNumber: roundNumber as number,
    }
  } catch {
    throw new CashOutRoundError('MATCH_UNAVAILABLE')
  }
}

export async function cashOutRound(
  request: CashOutRoundRequest,
  dependencies: CashOutRoundDependencies = {},
): Promise<CashOutRoundResponse> {
  const persist = dependencies.persist ?? persistDuelRoundCashOut
  const result = await persist({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
    requestId: request.requestId,
    roundNumber: request.roundNumber,
  })
  if (result.status === 'cashed_out' || result.status === 'retry') {
    return result.view
  }
  if (result.status === 'unavailable') {
    throw new CashOutRoundError('MATCH_UNAVAILABLE')
  }
  throw new CashOutRoundError('CASH_OUT_CONFLICT')
}
