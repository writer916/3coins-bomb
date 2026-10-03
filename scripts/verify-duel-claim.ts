/** DUEL participant B claim service/API checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClaimParticipantHandler } from '../api/duel/matches/[matchId]/claim.ts'
import {
  ClaimParticipantError,
  DUEL_CLAIM_BODY_MAX_BYTES,
  claimParticipant,
  validateClaimParticipantRequest,
  type ClaimParticipantRequest,
  type ClaimParticipantResponse,
} from '../server/duel/claimParticipant.ts'
import type {
  ClaimDuelParticipantInput,
  ClaimedDuelParticipant,
} from '../server/db/claimDuelParticipant.ts'
import {
  DUEL_INVITATION_TOKEN_PREFIX,
  DUEL_PARTICIPANT_B_TOKEN_PREFIX,
  DUEL_PARTICIPANT_TOKEN_PREFIX,
  DUEL_TOKEN_HMAC_KEY_ENV,
  deriveMatchCreationTokens,
  deriveParticipantBToken,
  hashDuelToken,
  validateDuelParticipantToken,
} from '../server/auth/duelTokens.ts'
import { validateGetDuelMatchRequest } from '../server/duel/getMatch.ts'

const root = resolve(import.meta.dirname, '..')
const matchId = '550e8400-e29b-41d4-a716-446655440000'
const otherMatchId = '650e8400-e29b-41d4-a716-446655440000'
const claimRecoverySecret = Buffer.alloc(32, 0x31).toString('base64url')
const otherClaimRecoverySecret = Buffer.alloc(32, 0x32).toString('base64url')
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64url'),
}
const invitationToken = deriveMatchCreationTokens(
  {
    createRequestId: matchId,
    createRecoverySecret: Buffer.alloc(32, 0x41).toString('base64url'),
  },
  fixtureEnvironment,
).invitationToken
const otherInvitationToken = deriveMatchCreationTokens(
  {
    createRequestId: otherMatchId,
    createRecoverySecret: Buffer.alloc(32, 0x42).toString('base64url'),
  },
  fixtureEnvironment,
).invitationToken

function expectClaimCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof ClaimParticipantError)
    assert.equal(error.code, code)
    assert(!error.message.includes(claimRecoverySecret))
    assert(!error.message.includes(invitationToken))
    return true
  })
}

const request = validateClaimParticipantRequest(
  matchId,
  `Bearer ${invitationToken}`,
  { claimRecoverySecret },
)
assert.deepEqual(request, {
  matchId,
  invitationToken,
  claimRecoverySecret,
})
expectClaimCode(
  () =>
    validateClaimParticipantRequest('invalid', `Bearer ${invitationToken}`, {
      claimRecoverySecret,
    }),
  'INVALID_REQUEST',
)
expectClaimCode(
  () => validateClaimParticipantRequest(matchId, 'Basic invalid', { claimRecoverySecret }),
  'INVALID_REQUEST',
)
expectClaimCode(
  () =>
    validateClaimParticipantRequest(matchId, `Bearer ${invitationToken}`, {
      claimRecoverySecret: 'invalid',
    }),
  'INVALID_REQUEST',
)
expectClaimCode(
  () =>
    validateClaimParticipantRequest(matchId, `Bearer ${invitationToken}`, {
      claimRecoverySecret,
      role: 'B',
    }),
  'INVALID_REQUEST',
)

interface ParticipantState {
  readonly matchId: string
  readonly invitationTokenHash: string | null
  readonly participantTokenHash: string | null
  readonly claimedAt: string | null
  readonly placementLockedAt: null
  readonly version: number
  readonly expired: boolean
  readonly creatorLocked: boolean
}

function initialState(
  id = matchId,
  invite = invitationToken,
  expired = false,
  creatorLocked = true,
): ParticipantState {
  return {
    matchId: id,
    invitationTokenHash: hashDuelToken(invite),
    participantTokenHash: null,
    claimedAt: null,
    placementLockedAt: null,
    version: 0,
    expired,
    creatorLocked,
  }
}

function memoryPersistence(...initial: ParticipantState[]) {
  const states = new Map(initial.map((state) => [state.matchId, state]))
  const persist = async (
    input: ClaimDuelParticipantInput,
  ): Promise<ClaimedDuelParticipant | null> => {
    const state = states.get(input.matchId)
    if (!state || state.expired || !state.creatorLocked) return null

    let claimed = false
    let next = state
    if (
      state.participantTokenHash === null &&
      state.invitationTokenHash === input.invitationTokenHash &&
      state.claimedAt === null
    ) {
      claimed = true
      next = {
        ...state,
        invitationTokenHash: null,
        participantTokenHash: input.participantTokenHash,
        claimedAt: '2026-01-01T00:00:01.000Z',
        version: state.version + 1,
      }
      states.set(input.matchId, next)
    } else if (
      state.participantTokenHash !== input.participantTokenHash ||
      state.invitationTokenHash !== null ||
      state.claimedAt === null
    ) {
      return null
    }

    return {
      matchId: state.matchId,
      totalRounds: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      claimedAt: next.claimedAt as string,
      expiresAt: null,
      formationVersion: 1,
      ruleVersion: 1,
      claimed,
    }
  }
  return { states, persist }
}

const memory = memoryPersistence(initialState())
const dependencies = { persist: memory.persist }

const first = await claimParticipant(request, dependencies)
assert.equal(first.claimed, true)
assert.equal(first.response.matchId, matchId)
assert.equal(first.response.participant.role, 'B')
assert.equal(first.response.participant.token, invitationToken)
assert(first.response.participant.token.startsWith(DUEL_INVITATION_TOKEN_PREFIX))
assert(!first.response.participant.token.startsWith(DUEL_PARTICIPANT_B_TOKEN_PREFIX))
assert(!first.response.participant.token.startsWith(DUEL_PARTICIPANT_TOKEN_PREFIX))
const claimedState = memory.states.get(matchId)
assert(claimedState)
assert.equal(claimedState.invitationTokenHash, null)
assert.equal(claimedState.participantTokenHash, hashDuelToken(invitationToken))
assert.equal(
  claimedState.participantTokenHash,
  hashDuelToken(first.response.participant.token),
)
assert.equal(claimedState.version, 1)
assert.equal(claimedState.placementLockedAt, null)
const originalClaimedAt = claimedState.claimedAt

/* Response-lost retry: same pi1 must restore without minting pb1 */
const retry = await claimParticipant(request, dependencies)
assert.equal(retry.claimed, false)
assert.equal(retry.response.participant.token, invitationToken)
assert.equal(retry.response.participant.token, first.response.participant.token)
assert.equal(memory.states.get(matchId)?.version, 1)
assert.equal(memory.states.get(matchId)?.claimedAt, originalClaimedAt)
assert.equal(
  memory.states.get(matchId)?.participantTokenHash,
  hashDuelToken(invitationToken),
)

/* Different recovery secret still yields the same durable pi1 auth */
const retryOtherSecret = await claimParticipant(
  { ...request, claimRecoverySecret: otherClaimRecoverySecret },
  dependencies,
)
assert.equal(retryOtherSecret.claimed, false)
assert.equal(retryOtherSecret.response.participant.token, invitationToken)

await assert.rejects(
  claimParticipant({ ...request, invitationToken: otherInvitationToken }, dependencies),
  (error: unknown) =>
    error instanceof ClaimParticipantError &&
    error.code === 'INVITATION_UNAVAILABLE',
)

const invalidInviteMemory = memoryPersistence(initialState())
await assert.rejects(
  claimParticipant(
    { ...request, invitationToken: otherInvitationToken },
    { persist: invalidInviteMemory.persist },
  ),
  (error: unknown) =>
    error instanceof ClaimParticipantError &&
    error.code === 'INVITATION_UNAVAILABLE',
)

const otherMatchMemory = memoryPersistence(
  initialState(otherMatchId, otherInvitationToken),
)
await assert.rejects(
  claimParticipant(
    { ...request, matchId: otherMatchId },
    { persist: otherMatchMemory.persist },
  ),
  (error: unknown) =>
    error instanceof ClaimParticipantError &&
    error.code === 'INVITATION_UNAVAILABLE',
)

const expiredMemory = memoryPersistence(initialState(matchId, invitationToken, true))
await assert.rejects(
  claimParticipant(request, { persist: expiredMemory.persist }),
  (error: unknown) =>
    error instanceof ClaimParticipantError &&
    error.code === 'INVITATION_UNAVAILABLE',
)

const creatorUnlockedMemory = memoryPersistence(
  initialState(matchId, invitationToken, false, false),
)
await assert.rejects(
  claimParticipant(request, { persist: creatorUnlockedMemory.persist }),
  (error: unknown) =>
    error instanceof ClaimParticipantError &&
    error.code === 'INVITATION_UNAVAILABLE',
)
assert.equal(
  creatorUnlockedMemory.states.get(matchId)?.participantTokenHash,
  null,
)

const sameConcurrentMemory = memoryPersistence(initialState())
const sameConcurrent = await Promise.all(
  Array.from({ length: 8 }, () =>
    claimParticipant(request, { persist: sameConcurrentMemory.persist }),
  ),
)
assert.equal(sameConcurrent.filter((result) => result.claimed).length, 1)
assert.equal(
  new Set(sameConcurrent.map((result) => result.response.participant.token)).size,
  1,
)
assert.equal(sameConcurrent[0]?.response.participant.token, invitationToken)
assert.equal(sameConcurrentMemory.states.get(matchId)?.version, 1)

/* Different recovery secrets no longer fork tokens — both resolve to pi1 */
const differentSecretMemory = memoryPersistence(initialState())
const differentSecretResults = await Promise.all(
  [
    claimParticipant(request, { persist: differentSecretMemory.persist }),
    claimParticipant(
      { ...request, claimRecoverySecret: otherClaimRecoverySecret },
      { persist: differentSecretMemory.persist },
    ),
  ],
)
assert.equal(differentSecretResults.filter((result) => result.claimed).length, 1)
assert.equal(
  new Set(
    differentSecretResults.map((result) => result.response.participant.token),
  ).size,
  1,
)
assert.equal(differentSecretResults[0]?.response.participant.token, invitationToken)
assert.equal(
  differentSecretMemory.states.get(matchId)?.participantTokenHash,
  hashDuelToken(invitationToken),
)

/* pi1 is a valid participant Bearer format; role comes from DB hash match */
assert.equal(validateDuelParticipantToken(invitationToken), invitationToken)
const legacyPb1 = deriveParticipantBToken(
  {
    matchId,
    invitationToken,
    claimRecoverySecret,
  },
  fixtureEnvironment,
)
assert.equal(validateDuelParticipantToken(legacyPb1), legacyPb1)
const getWithPi1 = validateGetDuelMatchRequest(
  matchId,
  `Bearer ${invitationToken}`,
)
assert.equal(getWithPi1.participantToken, invitationToken)
assert.equal(hashDuelToken(getWithPi1.participantToken), hashDuelToken(invitationToken))

/* Legacy claimed B (auth=pb1) retry path still works when persist sees pb1 auth */
const legacyMemory = memoryPersistence({
  ...initialState(),
  invitationTokenHash: null,
  participantTokenHash: hashDuelToken(legacyPb1),
  claimedAt: '2026-01-01T00:00:01.000Z',
  version: 1,
})
const legacyRetry = await claimParticipant(request, {
  deriveToken: () => legacyPb1,
  persist: legacyMemory.persist,
})
assert.equal(legacyRetry.claimed, false)
assert.equal(legacyRetry.response.participant.token, legacyPb1)
assert.equal(
  legacyMemory.states.get(matchId)?.participantTokenHash,
  hashDuelToken(legacyPb1),
)

const claimSource = readFileSync(
  resolve(root, 'server/duel/claimParticipant.ts'),
  'utf8',
)
assert(!claimSource.includes('deriveParticipantBToken'))
assert(claimSource.includes('request.invitationToken'))

const persistenceSource = readFileSync(
  resolve(root, 'server/db/claimDuelParticipant.ts'),
  'utf8',
).toLowerCase()
assert.equal((persistenceSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(persistenceSource.includes('with candidate as materialized'))
assert(persistenceSource.includes('for update of participant'))
assert(persistenceSource.includes('update duel_participants'))
assert(persistenceSource.includes("participant.role = 'b'"))
assert(persistenceSource.includes("creator.role = 'a'"))
assert(persistenceSource.includes('creator.placement_locked_at is not null'))
assert(persistenceSource.includes('invite_token_hash = null'))
assert(persistenceSource.includes('participant.version + 1'))
assert(persistenceSource.includes('match.expires_at is null'))
assert(persistenceSource.includes('match.expires_at > statement_timestamp()'))
assert(!persistenceSource.includes('.transaction('))

const response: ClaimParticipantResponse = first.response
const createdHandler = createClaimParticipantHandler(async () => ({
  claimed: true,
  response,
}))
const retryHandler = createClaimParticipantHandler(async () => ({
  claimed: false,
  response,
}))

function apiRequest(
  body: unknown,
  options: { authorization?: string; method?: string; id?: string } = {},
): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/claim`,
    {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.authorization ?? `Bearer ${invitationToken}`,
      },
      body: options.method === 'GET' ? undefined : JSON.stringify(body),
    },
  )
}

const createdResponse = await createdHandler(apiRequest({ claimRecoverySecret }))
assert.equal(createdResponse.status, 201)
assert.equal(createdResponse.headers.get('cache-control'), 'no-store')
const responseJson = (await createdResponse.json()) as Record<string, unknown>
assert.deepEqual(Object.keys(responseJson).sort(), [
  'claimedAt',
  'createdAt',
  'expiresAt',
  'formationVersion',
  'matchId',
  'participant',
  'ruleVersion',
  'totalRounds',
])
const serializedResponse = JSON.stringify(responseJson)
const participantJson = responseJson.participant as { role: string; token: string }
assert.equal(participantJson.role, 'B')
assert.equal(participantJson.token, invitationToken)
assert(!serializedResponse.includes(claimRecoverySecret))
assert(!serializedResponse.toLowerCase().includes('tokenhash'))
assert(!serializedResponse.toLowerCase().includes('placement'))

const retryResponse = await retryHandler(apiRequest({ claimRecoverySecret }))
assert.equal(retryResponse.status, 200)
assert.equal(retryResponse.headers.get('cache-control'), 'no-store')

const unavailableHandler = createClaimParticipantHandler(async () => {
  throw new ClaimParticipantError('INVITATION_UNAVAILABLE')
})
const unavailableResponse = await unavailableHandler(
  apiRequest({ claimRecoverySecret }),
)
assert.equal(unavailableResponse.status, 404)
assert.deepEqual(await unavailableResponse.json(), {
  error: { code: 'invitation_unavailable' },
})

const invalidResponse = await createdHandler(
  apiRequest({ claimRecoverySecret: 'invalid' }),
)
assert.equal(invalidResponse.status, 400)
assert.deepEqual(await invalidResponse.json(), {
  error: { code: 'invalid_request' },
})

const oversizedResponse = await createdHandler(
  apiRequest({ claimRecoverySecret: 'x'.repeat(DUEL_CLAIM_BODY_MAX_BYTES) }),
)
assert.equal(oversizedResponse.status, 400)

const methodResponse = await createdHandler(
  apiRequest({}, { method: 'GET' }),
)
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'POST')

const internalHandler = createClaimParticipantHandler(async () => {
  throw new Error('sensitive database detail')
})
const internalResponse = await internalHandler(apiRequest({ claimRecoverySecret }))
assert.equal(internalResponse.status, 500)
assert.deepEqual(await internalResponse.json(), {
  error: { code: 'internal_error' },
})

console.log('verify:duel-claim OK')
