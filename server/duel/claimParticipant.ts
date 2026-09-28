import {
  deriveParticipantBToken,
  hashDuelToken,
  parseBearerToken,
  validateClaimRecoverySecret,
  validateDuelInvitationToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  claimDuelParticipant,
  type ClaimDuelParticipantInput,
  type ClaimedDuelParticipant,
} from '../db/claimDuelParticipant.js'

export const DUEL_CLAIM_BODY_MAX_BYTES = 512

export type ClaimParticipantErrorCode =
  | 'INVALID_REQUEST'
  | 'INVITATION_UNAVAILABLE'

export class ClaimParticipantError extends Error {
  readonly code: ClaimParticipantErrorCode

  constructor(code: ClaimParticipantErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL invitation claim request is invalid.'
        : 'The DUEL invitation is unavailable.',
    )
    this.name = 'ClaimParticipantError'
    this.code = code
  }
}

export interface ClaimParticipantRequest {
  readonly matchId: string
  readonly invitationToken: string
  readonly claimRecoverySecret: string
}

export interface ClaimParticipantResponse {
  readonly matchId: string
  readonly totalRounds: number
  readonly participant: {
    readonly role: 'B'
    readonly token: string
  }
  readonly createdAt: string
  readonly claimedAt: string
  readonly expiresAt: string | null
  readonly formationVersion: number
  readonly ruleVersion: number
}

export interface ClaimParticipantResult {
  readonly claimed: boolean
  readonly response: ClaimParticipantResponse
}

export interface ClaimParticipantDependencies {
  readonly deriveToken?: (input: ClaimParticipantRequest) => string
  readonly persist?: (
    input: ClaimDuelParticipantInput,
  ) => Promise<ClaimedDuelParticipant | null>
}

function invalidRequest(): never {
  throw new ClaimParticipantError('INVALID_REQUEST')
}

export function validateClaimParticipantRequest(
  matchId: unknown,
  authorization: unknown,
  body: unknown,
): ClaimParticipantRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest()
  }

  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'claimRecoverySecret') {
    return invalidRequest()
  }

  try {
    return {
      matchId: validateMatchId(matchId),
      invitationToken: validateDuelInvitationToken(
        parseBearerToken(authorization),
      ),
      claimRecoverySecret: validateClaimRecoverySecret(
        record.claimRecoverySecret,
      ),
    }
  } catch {
    return invalidRequest()
  }
}

export async function claimParticipant(
  request: ClaimParticipantRequest,
  dependencies: ClaimParticipantDependencies = {},
): Promise<ClaimParticipantResult> {
  const deriveToken =
    dependencies.deriveToken ?? ((input) => deriveParticipantBToken(input))
  const persist = dependencies.persist ?? claimDuelParticipant
  const participantToken = deriveToken(request)
  const claimed = await persist({
    matchId: request.matchId,
    invitationTokenHash: hashDuelToken(request.invitationToken),
    participantTokenHash: hashDuelToken(participantToken),
  })

  if (!claimed) {
    throw new ClaimParticipantError('INVITATION_UNAVAILABLE')
  }

  return {
    claimed: claimed.claimed,
    response: {
      matchId: claimed.matchId,
      totalRounds: claimed.totalRounds,
      participant: { role: 'B', token: participantToken },
      createdAt: claimed.createdAt,
      claimedAt: claimed.claimedAt,
      expiresAt: claimed.expiresAt,
      formationVersion: claimed.formationVersion,
      ruleVersion: claimed.ruleVersion,
    },
  }
}
