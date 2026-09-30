import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  persistDuelBagOpen,
  type OpenDuelBagInput,
  type OpenDuelBagDiagnostics,
  type OpenDuelBagResult,
  type OpenDuelBagView,
} from '../db/openDuelBag.js'

export const DUEL_OPEN_BODY_MAX_BYTES = 256

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type OpenBagErrorCode =
  | 'INVALID_REQUEST'
  | 'MATCH_UNAVAILABLE'
  | 'OPEN_CONFLICT'

export class OpenBagError extends Error {
  readonly code: OpenBagErrorCode

  constructor(code: OpenBagErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL OPEN request is invalid.'
        : code === 'MATCH_UNAVAILABLE'
          ? 'The DUEL match is unavailable.'
          : 'The DUEL OPEN request conflicts with the current state.',
    )
    this.name = 'OpenBagError'
    this.code = code
  }
}

export interface OpenBagRequest {
  readonly matchId: string
  readonly participantToken: string
  readonly requestId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly expectedOpenOrder: number
}

export type OpenBagResponse = OpenDuelBagView

export interface OpenBagDependencies {
  readonly persist?: (
    input: OpenDuelBagInput,
    diagnostics?: OpenDuelBagDiagnostics,
  ) => Promise<OpenDuelBagResult>
  readonly onDatabaseTiming?: OpenDuelBagDiagnostics['onExecuteTiming']
}

function invalidRequest(): never {
  throw new OpenBagError('INVALID_REQUEST')
}

export function validateOpenBagRequest(
  matchId: unknown,
  roundNumber: unknown,
  authorization: unknown,
  idempotencyKey: unknown,
  body: unknown,
): OpenBagRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest()
  }
  const record = body as Record<string, unknown>
  if (
    Object.keys(record).sort().join(',') !== 'bagNumber,expectedOpenOrder' ||
    !Number.isInteger(record.bagNumber) ||
    (record.bagNumber as number) < 1 ||
    (record.bagNumber as number) > 8 ||
    !Number.isInteger(record.expectedOpenOrder) ||
    (record.expectedOpenOrder as number) < 1 ||
    (record.expectedOpenOrder as number) > 8 ||
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
      bagNumber: record.bagNumber as number,
      expectedOpenOrder: record.expectedOpenOrder as number,
    }
  } catch {
    throw new OpenBagError('MATCH_UNAVAILABLE')
  }
}

export async function openBag(
  request: OpenBagRequest,
  dependencies: OpenBagDependencies = {},
): Promise<OpenBagResponse> {
  const persist = dependencies.persist ?? persistDuelBagOpen
  const result = await persist(
    {
      matchId: request.matchId,
      participantTokenHash: hashDuelToken(request.participantToken),
      requestId: request.requestId,
      roundNumber: request.roundNumber,
      bagNumber: request.bagNumber,
      expectedOpenOrder: request.expectedOpenOrder,
    },
    { onExecuteTiming: dependencies.onDatabaseTiming },
  )
  if (result.status === 'opened' || result.status === 'retry') {
    return result.view
  }
  if (result.status === 'unavailable') {
    throw new OpenBagError('MATCH_UNAVAILABLE')
  }
  throw new OpenBagError('OPEN_CONFLICT')
}
