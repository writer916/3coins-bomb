import { createHash, createHmac } from 'node:crypto'

export const DUEL_TOKEN_HMAC_KEY_ENV = 'DUEL_TOKEN_HMAC_KEY'

export const DUEL_PARTICIPANT_TOKEN_PREFIX = '3cb_pa1_'
export const DUEL_INVITATION_TOKEN_PREFIX = '3cb_pi1_'
export const DUEL_PARTICIPANT_B_TOKEN_PREFIX = '3cb_pb1_'

const TOKEN_DERIVATION_VERSION = 1
const KEY_BYTE_LENGTH = 32
const RECOVERY_SECRET_BYTE_LENGTH = 32
const BASE64URL_32_BYTE_LENGTH = 43
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export type DuelTokenErrorCode =
  | 'INVALID_CREATE_RECOVERY_SECRET'
  | 'INVALID_CLAIM_RECOVERY_SECRET'
  | 'INVALID_CREATE_REQUEST_ID'
  | 'INVALID_MATCH_ID'
  | 'INVALID_INVITATION_TOKEN'
  | 'INVALID_PARTICIPANT_TOKEN'
  | 'MISSING_HMAC_KEY'
  | 'INVALID_HMAC_KEY'
  | 'INVALID_BEARER_TOKEN'

export class DuelTokenError extends Error {
  readonly code: DuelTokenErrorCode

  constructor(code: DuelTokenErrorCode, message: string) {
    super(message)
    this.name = 'DuelTokenError'
    this.code = code
  }
}

function decodeCanonicalBase64Url(
  value: unknown,
  byteLength: number,
  code: DuelTokenErrorCode,
  message: string,
): Buffer {
  if (
    typeof value !== 'string' ||
    value.length !== BASE64URL_32_BYTE_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new DuelTokenError(code, message)
  }

  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length !== byteLength || decoded.toString('base64url') !== value) {
    throw new DuelTokenError(code, message)
  }

  return decoded
}

export function validateCreateRecoverySecret(value: unknown): string {
  decodeCanonicalBase64Url(
    value,
    RECOVERY_SECRET_BYTE_LENGTH,
    'INVALID_CREATE_RECOVERY_SECRET',
    'createRecoverySecret must be a canonical base64url-encoded 32-byte value.',
  )
  return value as string
}

export function validateClaimRecoverySecret(value: unknown): string {
  decodeCanonicalBase64Url(
    value,
    RECOVERY_SECRET_BYTE_LENGTH,
    'INVALID_CLAIM_RECOVERY_SECRET',
    'claimRecoverySecret must be a canonical base64url-encoded 32-byte value.',
  )
  return value as string
}

export function validateCreateRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new DuelTokenError(
      'INVALID_CREATE_REQUEST_ID',
      'createRequestId must be a canonical UUID v4.',
    )
  }
  return value.toLowerCase()
}

export function validateMatchId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new DuelTokenError(
      'INVALID_MATCH_ID',
      'matchId must be a canonical UUID v4.',
    )
  }
  return value.toLowerCase()
}

export function validateDuelInvitationToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith(DUEL_INVITATION_TOKEN_PREFIX)
  ) {
    throw new DuelTokenError(
      'INVALID_INVITATION_TOKEN',
      'A valid DUEL invitation token is required.',
    )
  }

  const encodedToken = value.slice(DUEL_INVITATION_TOKEN_PREFIX.length)
  decodeCanonicalBase64Url(
    encodedToken,
    32,
    'INVALID_INVITATION_TOKEN',
    'A valid DUEL invitation token is required.',
  )
  return value
}

export function validateDuelParticipantToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    (!value.startsWith(DUEL_PARTICIPANT_TOKEN_PREFIX) &&
      !value.startsWith(DUEL_PARTICIPANT_B_TOKEN_PREFIX))
  ) {
    throw new DuelTokenError(
      'INVALID_PARTICIPANT_TOKEN',
      'A valid DUEL participant token is required.',
    )
  }

  const prefix = value.startsWith(DUEL_PARTICIPANT_TOKEN_PREFIX)
    ? DUEL_PARTICIPANT_TOKEN_PREFIX
    : DUEL_PARTICIPANT_B_TOKEN_PREFIX
  decodeCanonicalBase64Url(
    value.slice(prefix.length),
    32,
    'INVALID_PARTICIPANT_TOKEN',
    'A valid DUEL participant token is required.',
  )
  return value
}

export function readDuelTokenHmacKey(
  environment: NodeJS.ProcessEnv = process.env,
): Buffer {
  const encodedKey = environment[DUEL_TOKEN_HMAC_KEY_ENV]
  if (!encodedKey) {
    throw new DuelTokenError(
      'MISSING_HMAC_KEY',
      `${DUEL_TOKEN_HMAC_KEY_ENV} is required for server-side token derivation.`,
    )
  }

  return decodeCanonicalBase64Url(
    encodedKey,
    KEY_BYTE_LENGTH,
    'INVALID_HMAC_KEY',
    `${DUEL_TOKEN_HMAC_KEY_ENV} must be a canonical base64url-encoded 32-byte value.`,
  )
}

type TokenPurpose = 'participant-a-auth' | 'participant-b-invitation'

function updateFramed(hmac: ReturnType<typeof createHmac>, value: Uint8Array) {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(value.byteLength)
  hmac.update(length)
  hmac.update(value)
}

function deriveToken(
  key: Buffer,
  purpose: TokenPurpose,
  createRequestId: string,
  recoverySecret: Buffer,
  prefix: string,
): string {
  const hmac = createHmac('sha256', key)
  updateFramed(hmac, Buffer.from('3cb-duel-token', 'utf8'))
  updateFramed(hmac, Buffer.from([TOKEN_DERIVATION_VERSION]))
  updateFramed(hmac, Buffer.from(purpose, 'utf8'))
  updateFramed(hmac, Buffer.from(createRequestId, 'utf8'))
  updateFramed(hmac, recoverySecret)
  return prefix + hmac.digest('base64url')
}

export interface DeriveMatchCreationTokensInput {
  readonly createRequestId: unknown
  readonly createRecoverySecret: unknown
}

export interface MatchCreationTokens {
  readonly participantToken: string
  readonly invitationToken: string
}

export interface DeriveParticipantBTokenInput {
  readonly matchId: unknown
  readonly invitationToken: unknown
  readonly claimRecoverySecret: unknown
}

export function deriveMatchCreationTokens(
  input: DeriveMatchCreationTokensInput,
  environment: NodeJS.ProcessEnv = process.env,
): MatchCreationTokens {
  const createRequestId = validateCreateRequestId(input.createRequestId)
  const encodedRecoverySecret = validateCreateRecoverySecret(
    input.createRecoverySecret,
  )
  const recoverySecret = Buffer.from(encodedRecoverySecret, 'base64url')
  const key = readDuelTokenHmacKey(environment)

  return {
    participantToken: deriveToken(
      key,
      'participant-a-auth',
      createRequestId,
      recoverySecret,
      DUEL_PARTICIPANT_TOKEN_PREFIX,
    ),
    invitationToken: deriveToken(
      key,
      'participant-b-invitation',
      createRequestId,
      recoverySecret,
      DUEL_INVITATION_TOKEN_PREFIX,
    ),
  }
}

export function deriveParticipantBToken(
  input: DeriveParticipantBTokenInput,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const matchId = validateMatchId(input.matchId)
  const invitationToken = validateDuelInvitationToken(input.invitationToken)
  const encodedRecoverySecret = validateClaimRecoverySecret(
    input.claimRecoverySecret,
  )
  const recoverySecret = Buffer.from(encodedRecoverySecret, 'base64url')
  const key = readDuelTokenHmacKey(environment)
  const hmac = createHmac('sha256', key)
  updateFramed(hmac, Buffer.from('3cb-duel-token', 'utf8'))
  updateFramed(hmac, Buffer.from([TOKEN_DERIVATION_VERSION]))
  updateFramed(hmac, Buffer.from('participant-b-auth', 'utf8'))
  updateFramed(hmac, Buffer.from(matchId, 'utf8'))
  updateFramed(hmac, Buffer.from(invitationToken, 'utf8'))
  updateFramed(hmac, recoverySecret)
  return DUEL_PARTICIPANT_B_TOKEN_PREFIX + hmac.digest('base64url')
}

export function hashDuelToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function parseBearerToken(authorization: unknown): string {
  if (typeof authorization !== 'string') {
    throw new DuelTokenError(
      'INVALID_BEARER_TOKEN',
      'A Bearer authorization token is required.',
    )
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  if (!match) {
    throw new DuelTokenError(
      'INVALID_BEARER_TOKEN',
      'A valid Bearer authorization token is required.',
    )
  }

  return match[1]
}
