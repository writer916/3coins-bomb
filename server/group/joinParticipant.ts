import { validateCreateRequestId } from '../auth/duelTokens.js'
import {
  GROUP_HOST_TOKEN_PREFIX,
  GROUP_INVITATION_TOKEN_PREFIX,
  deriveGroupParticipantCapability,
  hashGroupCapability,
} from '../auth/groupTokens.js'
import {
  joinGroupParticipant as persistJoin,
  type JoinGroupParticipantInput as PersistJoinInput,
  type JoinedGroupParticipant,
} from '../db/joinGroupParticipant.js'
import {
  createGroupNicknameKey,
  validateGroupNickname,
} from '../../src/group/groupDomain.js'

export const GROUP_JOIN_BODY_MAX_BYTES = 1024
const CANONICAL_32 = '[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]'
const INVITATION_PATTERN = new RegExp(`^${GROUP_INVITATION_TOKEN_PREFIX}${CANONICAL_32}$`)
const HOST_PATTERN = new RegExp(`^${GROUP_HOST_TOKEN_PREFIX}${CANONICAL_32}$`)

export type JoinGroupParticipantErrorCode = 'INVALID_REQUEST' | 'JOIN_UNAVAILABLE'

export class JoinGroupParticipantError extends Error {
  readonly code: JoinGroupParticipantErrorCode
  constructor(code: JoinGroupParticipantErrorCode) {
    super('The GROUP participant could not be joined or resumed.')
    this.name = 'JoinGroupParticipantError'
    this.code = code
  }
}

export interface JoinGroupParticipantRequest {
  readonly groupId: string
  readonly invitationToken: string
  readonly hostToken: string | null
  readonly displayNickname: string
  readonly nicknameKey: string
}

export interface JoinGroupParticipantResponse {
  readonly groupId: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly status: 'open' | 'closed'
  readonly participant: {
    readonly id: string
    readonly displayNickname: string
    readonly token: string
    readonly acceptedAt: string
    readonly completedAt: string | null
    readonly excludedAt: string | null
    readonly version: number
  }
  readonly hostAuthenticated: boolean
}

export interface JoinGroupParticipantResult {
  readonly joined: boolean
  readonly response: JoinGroupParticipantResponse
}

export interface JoinGroupParticipantDependencies {
  readonly deriveParticipantToken?: (groupId: string, nicknameKey: string) => string
  readonly persist?: (input: PersistJoinInput) => Promise<JoinedGroupParticipant | null>
}

function isAtomicJoinRejection(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if ('code' in current && current.code === '22012') return true
    current = 'cause' in current ? current.cause : null
  }
  return false
}

function invalid(): never {
  throw new JoinGroupParticipantError('INVALID_REQUEST')
}

export function validateJoinGroupParticipantRequest(
  groupIdValue: unknown,
  bodyValue: unknown,
): JoinGroupParticipantRequest {
  if (typeof bodyValue !== 'object' || bodyValue === null || Array.isArray(bodyValue)) return invalid()
  const body = bodyValue as Record<string, unknown>
  const keys = Object.keys(body).sort()
  const expected = body.hostToken === undefined
    ? ['invitationToken', 'nickname']
    : ['hostToken', 'invitationToken', 'nickname']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return invalid()
  let groupId: string
  let displayNickname: string
  let nicknameKey: string
  try {
    groupId = validateCreateRequestId(groupIdValue)
    displayNickname = validateGroupNickname(body.nickname)
    nicknameKey = createGroupNicknameKey(displayNickname)
  } catch {
    return invalid()
  }
  if (typeof body.invitationToken !== 'string' || !INVITATION_PATTERN.test(body.invitationToken)) return invalid()
  if (
    body.hostToken !== undefined &&
    (typeof body.hostToken !== 'string' || !HOST_PATTERN.test(body.hostToken))
  ) return invalid()
  return {
    groupId,
    invitationToken: body.invitationToken,
    hostToken: (body.hostToken as string | undefined) ?? null,
    displayNickname,
    nicknameKey,
  }
}

export async function joinGroupParticipant(
  input: JoinGroupParticipantRequest,
  dependencies: JoinGroupParticipantDependencies = {},
): Promise<JoinGroupParticipantResult> {
  const deriveToken = dependencies.deriveParticipantToken ?? deriveGroupParticipantCapability
  const persist = dependencies.persist ?? persistJoin
  const participantToken = deriveToken(input.groupId, input.nicknameKey)
  let participant: JoinedGroupParticipant | null
  try {
    participant = await persist({
      groupId: input.groupId,
      invitationTokenHash: hashGroupCapability(input.invitationToken),
      hostTokenHash: input.hostToken === null ? null : hashGroupCapability(input.hostToken),
      displayNickname: input.displayNickname,
      nicknameKey: input.nicknameKey,
      authTokenHash: hashGroupCapability(participantToken),
    })
  } catch (error: unknown) {
    // The single SQL statement deliberately aborts with division_by_zero when
    // a newly inserted identity cannot reserve capacity. The abort rolls back
    // that insert; expose only the generic join boundary to callers.
    if (isAtomicJoinRejection(error)) {
      throw new JoinGroupParticipantError('JOIN_UNAVAILABLE')
    }
    throw error
  }
  if (!participant) throw new JoinGroupParticipantError('JOIN_UNAVAILABLE')
  return {
    joined: participant.joined,
    response: {
      groupId: participant.groupId,
      totalRounds: participant.totalRounds,
      playerLimit: participant.playerLimit,
      status: participant.groupStatus,
      participant: {
        id: participant.participantId,
        displayNickname: participant.displayNickname,
        token: participantToken,
        acceptedAt: participant.acceptedAt,
        completedAt: participant.completedAt,
        excludedAt: participant.excludedAt,
        version: participant.participantVersion,
      },
      hostAuthenticated: participant.isHost,
    },
  }
}
