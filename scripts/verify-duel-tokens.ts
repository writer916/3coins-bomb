/** DUEL server-only token derivation checks. No secret or token values are output. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DUEL_INVITATION_TOKEN_PREFIX,
  DUEL_PARTICIPANT_B_TOKEN_PREFIX,
  DUEL_PARTICIPANT_TOKEN_PREFIX,
  DUEL_TOKEN_HMAC_KEY_ENV,
  DuelTokenError,
  deriveMatchCreationTokens,
  deriveParticipantBToken,
  hashDuelToken,
  parseBearerToken,
  readDuelTokenHmacKey,
  validateCreateRecoverySecret,
  validateCreateRequestId,
  validateClaimRecoverySecret,
  validateDuelInvitationToken,
  validateMatchId,
} from '../server/auth/duelTokens.ts'

const root = resolve(import.meta.dirname, '..')
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64url'),
}
const recoverySecret = Buffer.alloc(32, 0x31).toString('base64url')
const otherRecoverySecret = Buffer.alloc(32, 0x32).toString('base64url')
const requestId = '550e8400-e29b-41d4-a716-446655440000'
const otherRequestId = '650e8400-e29b-41d4-a716-446655440000'

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof DuelTokenError)
    assert.equal(error.code, code)
    assert(!error.message.includes(recoverySecret))
    assert(!error.message.includes(fixtureEnvironment[DUEL_TOKEN_HMAC_KEY_ENV]))
    return true
  })
}

function filesBelow(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) result.push(...filesBelow(path))
    else result.push(path)
  }
  return result
}

assert.equal(validateCreateRecoverySecret(recoverySecret), recoverySecret)
assert.equal(validateClaimRecoverySecret(recoverySecret), recoverySecret)
assert.equal(validateCreateRequestId(requestId.toUpperCase()), requestId)
assert.equal(validateMatchId(requestId.toUpperCase()), requestId)

expectCode(
  () => validateCreateRecoverySecret('not-base64url'),
  'INVALID_CREATE_RECOVERY_SECRET',
)
expectCode(
  () => validateCreateRecoverySecret(`${recoverySecret}=`),
  'INVALID_CREATE_RECOVERY_SECRET',
)
expectCode(
  () => validateCreateRecoverySecret(Buffer.alloc(31).toString('base64url')),
  'INVALID_CREATE_RECOVERY_SECRET',
)
expectCode(
  () => validateClaimRecoverySecret('not-base64url'),
  'INVALID_CLAIM_RECOVERY_SECRET',
)
expectCode(() => validateCreateRequestId('not-a-uuid'), 'INVALID_CREATE_REQUEST_ID')
expectCode(
  () => validateCreateRequestId('550e8400-e29b-11d4-a716-446655440000'),
  'INVALID_CREATE_REQUEST_ID',
)
expectCode(
  () => validateCreateRequestId('550e8400-e29b-41d4-1716-446655440000'),
  'INVALID_CREATE_REQUEST_ID',
)
expectCode(() => readDuelTokenHmacKey({}), 'MISSING_HMAC_KEY')
expectCode(
  () =>
    readDuelTokenHmacKey({
      [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(31).toString('base64url'),
    }),
  'INVALID_HMAC_KEY',
)

const first = deriveMatchCreationTokens(
  { createRequestId: requestId, createRecoverySecret: recoverySecret },
  fixtureEnvironment,
)
const repeated = deriveMatchCreationTokens(
  { createRequestId: requestId, createRecoverySecret: recoverySecret },
  fixtureEnvironment,
)
const differentRequest = deriveMatchCreationTokens(
  { createRequestId: otherRequestId, createRecoverySecret: recoverySecret },
  fixtureEnvironment,
)
const differentRecovery = deriveMatchCreationTokens(
  { createRequestId: requestId, createRecoverySecret: otherRecoverySecret },
  fixtureEnvironment,
)

assert.deepEqual(first, repeated)
assert.notEqual(first.participantToken, first.invitationToken)
assert.notEqual(first.participantToken, differentRequest.participantToken)
assert.notEqual(first.invitationToken, differentRequest.invitationToken)
assert.notEqual(first.participantToken, differentRecovery.participantToken)
assert.notEqual(first.invitationToken, differentRecovery.invitationToken)
assert(first.participantToken.startsWith(DUEL_PARTICIPANT_TOKEN_PREFIX))
assert(first.invitationToken.startsWith(DUEL_INVITATION_TOKEN_PREFIX))
assert.equal(first.participantToken.length, DUEL_PARTICIPANT_TOKEN_PREFIX.length + 43)
assert.equal(first.invitationToken.length, DUEL_INVITATION_TOKEN_PREFIX.length + 43)
assert.equal(validateDuelInvitationToken(first.invitationToken), first.invitationToken)
expectCode(
  () => validateDuelInvitationToken(first.participantToken),
  'INVALID_INVITATION_TOKEN',
)

const participantB = deriveParticipantBToken(
  {
    matchId: requestId,
    invitationToken: first.invitationToken,
    claimRecoverySecret: recoverySecret,
  },
  fixtureEnvironment,
)
const repeatedParticipantB = deriveParticipantBToken(
  {
    matchId: requestId,
    invitationToken: first.invitationToken,
    claimRecoverySecret: recoverySecret,
  },
  fixtureEnvironment,
)
const differentMatchParticipantB = deriveParticipantBToken(
  {
    matchId: otherRequestId,
    invitationToken: first.invitationToken,
    claimRecoverySecret: recoverySecret,
  },
  fixtureEnvironment,
)
const differentRecoveryParticipantB = deriveParticipantBToken(
  {
    matchId: requestId,
    invitationToken: first.invitationToken,
    claimRecoverySecret: otherRecoverySecret,
  },
  fixtureEnvironment,
)
assert.equal(participantB, repeatedParticipantB)
assert(participantB.startsWith(DUEL_PARTICIPANT_B_TOKEN_PREFIX))
assert.equal(participantB.length, DUEL_PARTICIPANT_B_TOKEN_PREFIX.length + 43)
assert.notEqual(participantB, first.participantToken)
assert.notEqual(participantB, first.invitationToken)
assert.notEqual(participantB, differentMatchParticipantB)
assert.notEqual(participantB, differentRecoveryParticipantB)

const participantHash = hashDuelToken(first.participantToken)
const invitationHash = hashDuelToken(first.invitationToken)
assert.match(participantHash, /^[0-9a-f]{64}$/)
assert.match(invitationHash, /^[0-9a-f]{64}$/)
assert.notEqual(participantHash, invitationHash)

assert.equal(parseBearerToken(`Bearer ${first.participantToken}`), first.participantToken)
assert.equal(parseBearerToken(`bearer ${first.invitationToken}`), first.invitationToken)
expectCode(() => parseBearerToken(undefined), 'INVALID_BEARER_TOKEN')
expectCode(() => parseBearerToken('Basic credential'), 'INVALID_BEARER_TOKEN')
expectCode(() => parseBearerToken('Bearer two values'), 'INVALID_BEARER_TOKEN')

const clientFiles = filesBelow(resolve(root, 'src'))
for (const file of clientFiles) {
  const source = readFileSync(file, 'utf8')
  assert(!source.includes('server/auth/duelTokens'))
  assert(!source.includes(DUEL_TOKEN_HMAC_KEY_ENV))
}

console.log(
  `DUEL token utility verified; ${clientFiles.length} client files checked for server-only boundaries.`,
)
