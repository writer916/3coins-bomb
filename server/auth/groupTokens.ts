import { createHash, createHmac } from 'node:crypto'
import {
  readDuelTokenHmacKey,
  validateCreateRequestId,
} from './duelTokens.js'

export const GROUP_INVITATION_TOKEN_PREFIX = '3cb_gi1_'
export const GROUP_HOST_TOKEN_PREFIX = '3cb_gh1_'
export const GROUP_PARTICIPANT_TOKEN_PREFIX = '3cb_gp1_'
const CANONICAL_32_BYTE_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

const GROUP_TOKEN_DERIVATION_VERSION = 1

export interface GroupCreationCapabilities {
  readonly invitationToken: string
  readonly hostToken: string
}

function updateFramed(hmac: ReturnType<typeof createHmac>, value: Uint8Array): void {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(value.byteLength)
  hmac.update(length)
  hmac.update(value)
}

function deriveCapability(
  key: Buffer,
  purpose: 'invitation' | 'host' | 'participant',
  values: readonly string[],
  prefix: string,
): string {
  const hmac = createHmac('sha256', key)
  updateFramed(hmac, Buffer.from('3cb-group-token', 'utf8'))
  updateFramed(hmac, Buffer.from([GROUP_TOKEN_DERIVATION_VERSION]))
  updateFramed(hmac, Buffer.from(purpose, 'utf8'))
  for (const value of values) updateFramed(hmac, Buffer.from(value, 'utf8'))
  return prefix + hmac.digest('base64url')
}

/**
 * Deterministic capabilities make a lost create response recoverable without
 * storing plaintext secrets. GROUP uses a separate HMAC context and prefixes.
 */
export function deriveGroupCreationCapabilities(
  createRequestIdValue: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): GroupCreationCapabilities {
  const createRequestId = validateCreateRequestId(createRequestIdValue)
  const key = readDuelTokenHmacKey(environment)
  return {
    invitationToken: deriveCapability(
      key,
      'invitation',
      [createRequestId],
      GROUP_INVITATION_TOKEN_PREFIX,
    ),
    hostToken: deriveCapability(
      key,
      'host',
      [createRequestId],
      GROUP_HOST_TOKEN_PREFIX,
    ),
  }
}

/** Stable per-GROUP/nickname capability supports response-loss and cross-device resume. */
export function deriveGroupParticipantCapability(
  groupIdValue: unknown,
  nicknameKey: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const groupId = validateCreateRequestId(groupIdValue)
  if (typeof nicknameKey !== 'string' || nicknameKey.length === 0) {
    throw new Error('GROUP participant capability input is invalid.')
  }
  return deriveCapability(
    readDuelTokenHmacKey(environment),
    'participant',
    [groupId, nicknameKey],
    GROUP_PARTICIPANT_TOKEN_PREFIX,
  )
}

export function hashGroupCapability(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function validateGroupParticipantCapability(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith(GROUP_PARTICIPANT_TOKEN_PREFIX) ||
    !CANONICAL_32_BYTE_BASE64URL.test(
      value.slice(GROUP_PARTICIPANT_TOKEN_PREFIX.length),
    )
  ) {
    throw new Error('A valid GROUP participant capability is required.')
  }
  return value
}
