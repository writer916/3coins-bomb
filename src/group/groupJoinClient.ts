import {
  GROUP_FORMATION_VERSION,
  GROUP_RULE_VERSION,
  GROUP_SCORING_VERSION,
  validateGroupNickname,
} from './groupDomain'
import {
  classifyGroupUrlFragment,
  parseGroupHostUrl,
  parseGroupInvitationUrl,
} from './groupInvitation'
import {
  readGroupHost,
  saveGroupHost,
  saveGroupParticipant,
  type GroupParticipantRecord,
  type GroupStorageAdapter,
} from './groupPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PARTICIPANT_PATTERN = /^3cb_gp1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export class GroupJoinClientError extends Error {
  readonly code: 'INVALID_NICKNAME' | 'JOIN_UNAVAILABLE'
  constructor(code: 'INVALID_NICKNAME' | 'JOIN_UNAVAILABLE') {
    super('The GROUP participant could not be joined or resumed.')
    this.name = 'GroupJoinClientError'
    this.code = code
  }
}

export interface GroupJoinClientDependencies {
  readonly storage: GroupStorageAdapter
  readonly fetch: typeof fetch
}

export interface GroupJoinClientResult {
  readonly newlyJoined: boolean
  readonly participant: GroupParticipantRecord
  readonly totalRounds: number
  readonly playerLimit: number
  readonly status: 'open' | 'closed'
  readonly hostAuthenticated: boolean
}

function unavailable(): never {
  throw new GroupJoinClientError('JOIN_UNAVAILABLE')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable()
  return value as Record<string, unknown>
}

function parseResponse(
  value: unknown,
  expectedGroupId: string,
): Omit<GroupJoinClientResult, 'newlyJoined'> {
  const response = object(value)
  const participant = object(response.participant)
  const expectedResponse = ['groupId', 'totalRounds', 'playerLimit', 'status', 'participant', 'hostAuthenticated'].sort()
  const expectedParticipant = [
    'id', 'displayNickname', 'token', 'acceptedAt', 'completedAt', 'excludedAt', 'version',
  ].sort()
  if (
    Object.keys(response).sort().some((key, index) => key !== expectedResponse[index]) ||
    Object.keys(response).length !== expectedResponse.length ||
    Object.keys(participant).sort().some((key, index) => key !== expectedParticipant[index]) ||
    Object.keys(participant).length !== expectedParticipant.length ||
    response.groupId !== expectedGroupId ||
    typeof response.totalRounds !== 'number' || !Number.isInteger(response.totalRounds) ||
    response.totalRounds < 1 || response.totalRounds > 20 ||
    typeof response.playerLimit !== 'number' || !Number.isInteger(response.playerLimit) ||
    response.playerLimit < 2 || response.playerLimit > 20 ||
    (response.status !== 'open' && response.status !== 'closed') ||
    typeof response.hostAuthenticated !== 'boolean' ||
    typeof participant.id !== 'string' || !UUID_V4_PATTERN.test(participant.id) ||
    typeof participant.displayNickname !== 'string' ||
    typeof participant.token !== 'string' || !PARTICIPANT_PATTERN.test(participant.token) ||
    typeof participant.acceptedAt !== 'string' ||
    (participant.completedAt !== null && typeof participant.completedAt !== 'string') ||
    (participant.excludedAt !== null && typeof participant.excludedAt !== 'string') ||
    typeof participant.version !== 'number' || !Number.isInteger(participant.version) || participant.version < 0
  ) return unavailable()
  let displayNickname: string
  let acceptedAt: string
  try {
    displayNickname = validateGroupNickname(participant.displayNickname)
    acceptedAt = new Date(participant.acceptedAt).toISOString()
    if (acceptedAt !== participant.acceptedAt) return unavailable()
    if (participant.completedAt !== null && new Date(participant.completedAt).toISOString() !== participant.completedAt) return unavailable()
    if (participant.excludedAt !== null && new Date(participant.excludedAt).toISOString() !== participant.excludedAt) return unavailable()
  } catch {
    return unavailable()
  }
  return {
    participant: {
      version: 1,
      groupId: expectedGroupId,
      participantId: participant.id.toLowerCase(),
      displayNickname,
      token: participant.token,
      acceptedAt,
    },
    totalRounds: response.totalRounds,
    playerLimit: response.playerLimit,
    status: response.status,
    hostAuthenticated: response.hostAuthenticated,
  }
}

interface ResolvedJoinUrl {
  readonly groupId: string
  readonly invitationToken: string
  readonly hostToken: string | null
}

function resolveJoinUrl(
  entryUrl: string,
  storage: GroupStorageAdapter,
): ResolvedJoinUrl {
  const kind = classifyGroupUrlFragment(entryUrl)
  if (kind === 'host') {
    const parsed = parseGroupHostUrl(entryUrl)
    return {
      groupId: parsed.groupId,
      invitationToken: parsed.invitationToken,
      hostToken: parsed.hostToken,
    }
  }
  if (kind === 'invite') {
    const invitation = parseGroupInvitationUrl(entryUrl)
    const host = readGroupHost(storage, invitation.groupId)
    return {
      groupId: invitation.groupId,
      invitationToken: invitation.invitationToken,
      hostToken: host?.hostToken ?? null,
    }
  }
  return unavailable()
}

async function executeJoin(
  entryUrl: string,
  nicknameValue: string,
  dependencies: GroupJoinClientDependencies,
): Promise<GroupJoinClientResult> {
  let nickname: string
  try {
    nickname = validateGroupNickname(nicknameValue)
  } catch {
    throw new GroupJoinClientError('INVALID_NICKNAME')
  }
  try {
    const resolved = resolveJoinUrl(entryUrl, dependencies.storage)
    const body: Record<string, string> = {
      invitationToken: resolved.invitationToken,
      nickname,
    }
    if (resolved.hostToken !== null) body.hostToken = resolved.hostToken
    const response = await dependencies.fetch(
      `/api/group/matches/${encodeURIComponent(resolved.groupId)}/join`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!response.ok) return unavailable()
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return unavailable()
    }
    const result = parseResponse(json, resolved.groupId)
    saveGroupParticipant(dependencies.storage, result.participant)
    if (result.hostAuthenticated && resolved.hostToken !== null) {
      saveGroupHost(dependencies.storage, {
        version: 1,
        groupId: resolved.groupId,
        invitationToken: resolved.invitationToken,
        hostToken: resolved.hostToken,
        totalRounds: result.totalRounds,
        playerLimit: result.playerLimit,
        formationVersion: GROUP_FORMATION_VERSION,
        ruleVersion: GROUP_RULE_VERSION,
        scoringVersion: GROUP_SCORING_VERSION,
      })
    }
    return { ...result, newlyJoined: response.status === 201 }
  } catch (error: unknown) {
    if (error instanceof GroupJoinClientError) throw error
    throw new GroupJoinClientError('JOIN_UNAVAILABLE')
  }
}

export function createGroupJoinCoordinator(
  dependencies: GroupJoinClientDependencies,
): { run(entryUrl: string, nickname: string): Promise<GroupJoinClientResult> } {
  let inFlight: Promise<GroupJoinClientResult> | null = null
  return {
    run(entryUrl, nickname) {
      if (inFlight) return inFlight
      inFlight = executeJoin(entryUrl, nickname, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
