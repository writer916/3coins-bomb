import {
  deriveMatchCreationTokens,
  hashDuelToken,
  validateCreateRecoverySecret,
  validateCreateRequestId,
  type MatchCreationTokens,
} from '../auth/duelTokens.js'
import {
  persistDuelMatch,
  type PersistDuelMatchInput,
  type PersistedDuelMatch,
} from '../db/createDuelMatch.js'

export const DUEL_CREATE_BODY_MAX_BYTES = 1024

export type CreateDuelMatchErrorCode =
  | 'INVALID_REQUEST'
  | 'CREATE_REQUEST_CONFLICT'

export class CreateDuelMatchError extends Error {
  readonly code: CreateDuelMatchErrorCode

  constructor(code: CreateDuelMatchErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL match creation request is invalid.'
        : 'The create request conflicts with an existing match.',
    )
    this.name = 'CreateDuelMatchError'
    this.code = code
  }
}

export interface CreateDuelMatchInput {
  readonly createRequestId: string
  readonly totalRounds: number
  readonly createRecoverySecret: string
}

export interface CreateDuelMatchResponse {
  readonly matchId: string
  readonly totalRounds: number
  readonly participant: {
    readonly role: 'A'
    readonly token: string
  }
  readonly invitation: {
    readonly token: string
  }
  readonly createdAt: string
  readonly expiresAt: null
  readonly formationVersion: 1
  readonly ruleVersion: 1
}

export interface CreateDuelMatchResult {
  readonly created: boolean
  readonly response: CreateDuelMatchResponse
}

export interface CreateDuelMatchDependencies {
  readonly deriveTokens?: (
    input: Pick<CreateDuelMatchInput, 'createRequestId' | 'createRecoverySecret'>,
  ) => MatchCreationTokens
  readonly persist?: (
    input: PersistDuelMatchInput,
  ) => Promise<PersistedDuelMatch | null>
}

function invalidRequest(): never {
  throw new CreateDuelMatchError('INVALID_REQUEST')
}

export function validateCreateDuelMatchInput(
  createRequestId: unknown,
  body: unknown,
): CreateDuelMatchInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest()
  }

  const record = body as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'createRecoverySecret' ||
    keys[1] !== 'totalRounds'
  ) {
    return invalidRequest()
  }

  if (
    !Number.isInteger(record.totalRounds) ||
    (record.totalRounds as number) < 1 ||
    (record.totalRounds as number) > 20
  ) {
    return invalidRequest()
  }

  try {
    return {
      createRequestId: validateCreateRequestId(createRequestId),
      totalRounds: record.totalRounds as number,
      createRecoverySecret: validateCreateRecoverySecret(
        record.createRecoverySecret,
      ),
    }
  } catch {
    return invalidRequest()
  }
}

export async function createDuelMatch(
  input: CreateDuelMatchInput,
  dependencies: CreateDuelMatchDependencies = {},
): Promise<CreateDuelMatchResult> {
  const deriveTokens =
    dependencies.deriveTokens ?? ((tokenInput) => deriveMatchCreationTokens(tokenInput))
  const persist = dependencies.persist ?? persistDuelMatch
  const tokens = deriveTokens(input)
  const persisted = await persist({
    createRequestId: input.createRequestId,
    totalRounds: input.totalRounds,
    participantTokenHash: hashDuelToken(tokens.participantToken),
    invitationTokenHash: hashDuelToken(tokens.invitationToken),
  })

  if (!persisted) {
    throw new CreateDuelMatchError('CREATE_REQUEST_CONFLICT')
  }

  return {
    created: persisted.created,
    response: {
      matchId: persisted.matchId,
      totalRounds: persisted.totalRounds,
      participant: { role: 'A', token: tokens.participantToken },
      invitation: { token: tokens.invitationToken },
      createdAt: persisted.createdAt,
      expiresAt: persisted.expiresAt,
      formationVersion: persisted.formationVersion,
      ruleVersion: persisted.ruleVersion,
    },
  }
}
