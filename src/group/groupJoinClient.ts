import { validateGroupNickname } from './groupDomain'
import { parseGroupInvitationUrl } from './groupInvitation'
import {
  readGroupHost,
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

async function executeJoin(
  invitationUrl: string,
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
    const invitation = parseGroupInvitationUrl(invitationUrl)
    const host = readGroupHost(dependencies.storage, invitation.groupId)
    const body: Record<string, string> = {
      invitationToken: invitation.invitationToken,
      nickname,
    }
    if (host) body.hostToken = host.hostToken
    const response = await dependencies.fetch(
      `/api/group/matches/${encodeURIComponent(invitation.groupId)}/join`,
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
    const result = parseResponse(json, invitation.groupId)
    saveGroupParticipant(dependencies.storage, result.participant)
    return { ...result, newlyJoined: response.status === 201 }
  } catch (error: unknown) {
    if (error instanceof GroupJoinClientError) throw error
    throw new GroupJoinClientError('JOIN_UNAVAILABLE')
  }
}

export function createGroupJoinCoordinator(
  dependencies: GroupJoinClientDependencies,
): { run(invitationUrl: string, nickname: string): Promise<GroupJoinClientResult> } {
  let inFlight: Promise<GroupJoinClientResult> | null = null
  return {
    run(invitationUrl, nickname) {
      if (inFlight) return inFlight
      inFlight = executeJoin(invitationUrl, nickname, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
