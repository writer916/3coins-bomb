import { validateCreateRequestId } from '../auth/duelTokens.js'
import {
  deriveGroupCreationCapabilities,
  hashGroupCapability,
  type GroupCreationCapabilities,
} from '../auth/groupTokens.js'
import {
  persistGroupMatch,
  type PersistedGroupMatch,
  type PersistGroupMatchInput,
} from '../db/createGroupMatch.js'
import {
  GROUP_FORMATION_VERSION,
  GROUP_RULE_VERSION,
  GROUP_SCORING_VERSION,
  validateGroupPlacementSet,
  validateGroupPlayers,
  validateGroupRounds,
  type GroupPlacementCandidate,
} from '../../src/group/groupDomain.js'
import {
  createGeneratedGroupPlacementProvider,
  type GroupPlacementProvider,
} from './groupPlacementProvider.js'

export const GROUP_CREATE_BODY_MAX_BYTES = 512

export type CreateGroupMatchErrorCode =
  | 'INVALID_REQUEST'
  | 'CREATE_REQUEST_CONFLICT'

export class CreateGroupMatchError extends Error {
  readonly code: CreateGroupMatchErrorCode

  constructor(code: CreateGroupMatchErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The GROUP creation request is invalid.'
        : 'The create request conflicts with an existing GROUP.',
    )
    this.name = 'CreateGroupMatchError'
    this.code = code
  }
}

export interface CreateGroupMatchInput {
  readonly createRequestId: string
  readonly totalRounds: number
  readonly playerLimit: number
}

export interface CreateGroupMatchResponse {
  readonly groupId: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly invitation: { readonly token: string }
  readonly host: { readonly token: string }
  readonly createdAt: string
  readonly expiresAt: null
  readonly formationVersion: typeof GROUP_FORMATION_VERSION
  readonly ruleVersion: typeof GROUP_RULE_VERSION
  readonly scoringVersion: typeof GROUP_SCORING_VERSION
}

export interface CreateGroupMatchResult {
  readonly created: boolean
  readonly response: CreateGroupMatchResponse
}

export interface CreateGroupMatchDependencies {
  readonly deriveCapabilities?: (
    createRequestId: string,
  ) => GroupCreationCapabilities
  readonly placementProvider?: GroupPlacementProvider
  readonly persist?: (
    input: PersistGroupMatchInput,
  ) => Promise<PersistedGroupMatch | null>
}

function invalidRequest(): never {
  throw new CreateGroupMatchError('INVALID_REQUEST')
}

export function validateCreateGroupMatchInput(
  createRequestIdValue: unknown,
  body: unknown,
): CreateGroupMatchInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest()
  }
  const record = body as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'playerLimit' ||
    keys[1] !== 'totalRounds'
  ) {
    return invalidRequest()
  }
  try {
    return {
      createRequestId: validateCreateRequestId(createRequestIdValue),
      totalRounds: validateGroupRounds(record.totalRounds),
      playerLimit: validateGroupPlayers(record.playerLimit),
    }
  } catch {
    return invalidRequest()
  }
}

export async function createGroupMatch(
  input: CreateGroupMatchInput,
  dependencies: CreateGroupMatchDependencies = {},
): Promise<CreateGroupMatchResult> {
  const deriveCapabilities =
    dependencies.deriveCapabilities ?? deriveGroupCreationCapabilities
  const placementProvider =
    dependencies.placementProvider ?? createGeneratedGroupPlacementProvider()
  const persist = dependencies.persist ?? persistGroupMatch
  const capabilities = deriveCapabilities(input.createRequestId)
  let placements: readonly GroupPlacementCandidate[]
  try {
    placements = validateGroupPlacementSet({
      totalRounds: input.totalRounds,
      placements: placementProvider.provide(input.totalRounds),
    }).placements
  } catch {
    throw new CreateGroupMatchError('INVALID_REQUEST')
  }
  const persisted = await persist({
    createRequestId: input.createRequestId,
    totalRounds: input.totalRounds,
    playerLimit: input.playerLimit,
    invitationTokenHash: hashGroupCapability(capabilities.invitationToken),
    hostTokenHash: hashGroupCapability(capabilities.hostToken),
    placements,
  })
  if (!persisted) throw new CreateGroupMatchError('CREATE_REQUEST_CONFLICT')
  return {
    created: persisted.created,
    response: {
      groupId: persisted.groupId,
      totalRounds: persisted.totalRounds,
      playerLimit: persisted.playerLimit,
      invitation: { token: capabilities.invitationToken },
      host: { token: capabilities.hostToken },
      createdAt: persisted.createdAt,
      expiresAt: persisted.expiresAt,
      formationVersion: persisted.formationVersion,
      ruleVersion: persisted.ruleVersion,
      scoringVersion: persisted.scoringVersion,
    },
  }
}
