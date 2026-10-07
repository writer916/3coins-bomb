import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import {
  hashGroupCapability,
  validateGroupParticipantCapability,
} from '../auth/groupTokens.js'
import {
  getGroupPlacements,
  getGroupPlayState,
  resumeGroupPlay,
  startGroupRound,
  type PersistedGroupPlacementSet,
  type PersistedGroupPlayState,
} from '../db/groupPlay.js'
import {
  GROUP_FORMATION_VERSION,
  GROUP_RULE_VERSION,
  validateGroupPlacement,
} from '../../src/group/groupDomain.js'

export class GroupPlayError extends Error {
  readonly code: 'UNAVAILABLE' | 'CANNOT_START'
  constructor(code: 'UNAVAILABLE' | 'CANNOT_START' = 'UNAVAILABLE') {
    super('The GROUP play state is unavailable.')
    this.name = 'GroupPlayError'
    this.code = code
  }
}

export interface GroupPlayAuthRequest {
  readonly groupId: string
  readonly participantTokenHash: string
}

export interface GroupPlayCommand extends GroupPlayAuthRequest {
  readonly requestId: string
}

export interface GroupPlayDependencies {
  readonly getState?: typeof getGroupPlayState
  readonly getPlacements?: typeof getGroupPlacements
  readonly start?: typeof startGroupRound
  readonly resume?: typeof resumeGroupPlay
}

export function validateGroupPlayAuth(
  groupIdValue: unknown,
  authorization: unknown,
): GroupPlayAuthRequest {
  try {
    const token = validateGroupParticipantCapability(parseBearerToken(authorization))
    return {
      groupId: validateCreateRequestId(groupIdValue),
      participantTokenHash: hashGroupCapability(token),
    }
  } catch {
    throw new GroupPlayError()
  }
}

export function validateGroupPlayCommand(
  groupIdValue: unknown,
  authorization: unknown,
  requestIdValue: unknown,
): GroupPlayCommand {
  const auth = validateGroupPlayAuth(groupIdValue, authorization)
  try {
    return { ...auth, requestId: validateCreateRequestId(requestIdValue) }
  } catch {
    throw new GroupPlayError()
  }
}

export async function readGroupPlayState(
  request: GroupPlayAuthRequest,
  dependencies: GroupPlayDependencies = {},
): Promise<PersistedGroupPlayState> {
  const value = await (dependencies.getState ?? getGroupPlayState)(
    request.groupId,
    request.participantTokenHash,
  )
  if (!value) throw new GroupPlayError()
  return value
}

export async function readGroupPlayPlacements(
  request: GroupPlayAuthRequest,
  dependencies: GroupPlayDependencies = {},
): Promise<PersistedGroupPlacementSet> {
  const value = await (dependencies.getPlacements ?? getGroupPlacements)(
    request.groupId,
    request.participantTokenHash,
  )
  if (
    !value ||
    value.groupId !== request.groupId ||
    value.formationVersion !== GROUP_FORMATION_VERSION ||
    value.ruleVersion !== GROUP_RULE_VERSION ||
    value.placements.length !== value.totalRounds
  ) throw new GroupPlayError()
  try {
    value.placements.forEach((placement, index) => {
      validateGroupPlacement(placement, index + 1)
    })
  } catch {
    throw new GroupPlayError()
  }
  return value
}

export async function beginGroupRound(
  request: GroupPlayCommand,
  dependencies: GroupPlayDependencies = {},
): Promise<PersistedGroupPlayState> {
  const value = await (dependencies.start ?? startGroupRound)(request)
  if (!value) throw new GroupPlayError('CANNOT_START')
  return value
}

export async function explicitlyResumeGroupPlay(
  request: GroupPlayCommand,
  dependencies: GroupPlayDependencies = {},
): Promise<PersistedGroupPlayState> {
  const value = await (dependencies.resume ?? resumeGroupPlay)(request)
  if (!value) throw new GroupPlayError()
  return value
}
