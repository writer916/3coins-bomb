/** DUEL authenticated participant match view checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetDuelMatchHandler } from '../api/_duel/matches/[matchId].ts'
import {
  GetDuelMatchError,
  getDuelMatch,
  validateGetDuelMatchRequest,
  type GetDuelMatchResponse,
} from '../server/duel/getMatch.ts'
import type {
  GetDuelMatchInput,
  PersistedDuelMatchView,
} from '../server/db/getDuelMatch.ts'
import {
  DUEL_TOKEN_HMAC_KEY_ENV,
  deriveMatchCreationTokens,
  deriveParticipantBToken,
  hashDuelToken,
} from '../server/auth/duelTokens.ts'

const root = resolve(import.meta.dirname, '..')
const matchId = '550e8400-e29b-41d4-a716-446655440000'
const otherMatchId = '650e8400-e29b-41d4-a716-446655440000'
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64url'),
}
const creationTokens = deriveMatchCreationTokens(
  {
    createRequestId: matchId,
    createRecoverySecret: Buffer.alloc(32, 0x41).toString('base64url'),
  },
  fixtureEnvironment,
)
const participantAToken = creationTokens.participantToken
const participantBToken = deriveParticipantBToken(
  {
    matchId,
    invitationToken: creationTokens.invitationToken,
    claimRecoverySecret: Buffer.alloc(32, 0x42).toString('base64url'),
  },
  fixtureEnvironment,
)

function state(
  role: 'A' | 'B',
  options: {
    selfClaimed?: boolean
    selfLocked?: boolean
    opponentClaimed?: boolean
    opponentLocked?: boolean
    expiresAt?: string | null
  } = {},
): PersistedDuelMatchView {
  return {
    matchId,
    totalRounds: 5,
    role,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: options.expiresAt ?? null,
    formationVersion: 1,
    ruleVersion: 1,
    self: {
      claimed: options.selfClaimed ?? true,
      placementLocked: options.selfLocked ?? false,
    },
    opponent: {
      claimed: options.opponentClaimed ?? true,
      placementLocked: options.opponentLocked ?? false,
    },
  }
}

function expectUnavailable(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof GetDuelMatchError)
    assert.equal(error.code, 'MATCH_UNAVAILABLE')
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}

const requestA = validateGetDuelMatchRequest(
  matchId,
  `Bearer ${participantAToken}`,
)
assert.deepEqual(requestA, { matchId, participantToken: participantAToken })
const requestB = validateGetDuelMatchRequest(
  matchId,
  `Bearer ${participantBToken}`,
)
assert.deepEqual(requestB, { matchId, participantToken: participantBToken })
const invitationToken = creationTokens.invitationToken
const requestPromotedB = validateGetDuelMatchRequest(
  matchId,
  `Bearer ${invitationToken}`,
)
assert.deepEqual(requestPromotedB, {
  matchId,
  participantToken: invitationToken,
})
expectUnavailable(() => validateGetDuelMatchRequest('invalid', `Bearer ${participantAToken}`))
expectUnavailable(() => validateGetDuelMatchRequest(matchId, 'Bearer invalid'))
expectUnavailable(() => validateGetDuelMatchRequest(matchId, 'Basic invalid'))

function memoryGet(
  expectedMatchId: string,
  expectedToken: string,
  response: PersistedDuelMatchView | null,
) {
  return async (input: GetDuelMatchInput): Promise<PersistedDuelMatchView | null> => {
    if (
      input.matchId !== expectedMatchId ||
      input.participantTokenHash !== hashDuelToken(expectedToken)
    ) {
      return null
    }
    return response
  }
}

const aBeforeBClaim = state('A', {
  selfLocked: true,
  opponentClaimed: false,
  opponentLocked: false,
})
const aDuringBPlacement = state('A', {
  selfLocked: true,
  opponentClaimed: true,
  opponentLocked: false,
})
const aAfterBLock = state('A', {
  selfLocked: true,
  opponentClaimed: true,
  opponentLocked: true,
})
const bDuringPlacement = state('B', {
  selfLocked: false,
  opponentClaimed: true,
  opponentLocked: true,
})
const bAfterLock = state('B', {
  selfLocked: true,
  opponentClaimed: true,
  opponentLocked: true,
})

for (const expected of [aBeforeBClaim, aDuringBPlacement, aAfterBLock]) {
  const actual = await getDuelMatch(requestA, {
    getMatch: memoryGet(matchId, participantAToken, expected),
  })
  assert.deepEqual(actual, expected)
  assert.equal(actual.role, 'A')
}

for (const expected of [bDuringPlacement, bAfterLock]) {
  const actual = await getDuelMatch(requestB, {
    getMatch: memoryGet(matchId, participantBToken, expected),
  })
  assert.deepEqual(actual, expected)
  assert.equal(actual.role, 'B')
}

/* Promoted B auth: same pi1 invitation token is the Bearer capability */
for (const expected of [bDuringPlacement, bAfterLock]) {
  const actual = await getDuelMatch(requestPromotedB, {
    getMatch: memoryGet(matchId, invitationToken, expected),
  })
  assert.deepEqual(actual, expected)
  assert.equal(actual.role, 'B')
}
assert.equal(
  hashDuelToken(invitationToken),
  hashDuelToken(requestPromotedB.participantToken),
)

await assert.rejects(
  getDuelMatch(requestA, { getMatch: memoryGet(matchId, participantAToken, null) }),
  (error: unknown) => error instanceof GetDuelMatchError,
)
await assert.rejects(
  getDuelMatch(
    { ...requestA, matchId: otherMatchId },
    { getMatch: memoryGet(matchId, participantAToken, aAfterBLock) },
  ),
  (error: unknown) => error instanceof GetDuelMatchError,
)
await assert.rejects(
  getDuelMatch(
    { ...requestA, participantToken: participantBToken },
    { getMatch: memoryGet(matchId, participantAToken, aAfterBLock) },
  ),
  (error: unknown) => error instanceof GetDuelMatchError,
)

const persistenceSource = readFileSync(
  resolve(root, 'server/db/getDuelMatch.ts'),
  'utf8',
).toLowerCase()
assert.equal((persistenceSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(persistenceSource.includes('self.auth_token_hash'))
assert(persistenceSource.includes('self.placement_locked_at is not null'))
assert(persistenceSource.includes('opponent.placement_locked_at is not null'))
assert(persistenceSource.includes('match.expires_at is null'))
assert(persistenceSource.includes('match.expires_at > statement_timestamp()'))
assert(!persistenceSource.includes('select *'))
assert(!persistenceSource.includes('invite_token_hash'))

const response: GetDuelMatchResponse = aAfterBLock
const successHandler = createGetDuelMatchHandler(async () => response)

function apiRequest(
  options: { authorization?: string; method?: string; id?: string } = {},
): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}`,
    {
      method: options.method ?? 'GET',
      headers: {
        Authorization: options.authorization ?? `Bearer ${participantAToken}`,
      },
    },
  )
}

const successResponse = await successHandler(apiRequest())
assert.equal(successResponse.status, 200)
assert.equal(successResponse.headers.get('cache-control'), 'no-store')
const responseJson = (await successResponse.json()) as Record<string, unknown>
assert.deepEqual(Object.keys(responseJson).sort(), [
  'createdAt',
  'expiresAt',
  'formationVersion',
  'matchId',
  'opponent',
  'role',
  'ruleVersion',
  'self',
  'totalRounds',
])
assert.deepEqual(Object.keys(responseJson.self as object).sort(), [
  'claimed',
  'placementLocked',
])
assert.deepEqual(Object.keys(responseJson.opponent as object).sort(), [
  'claimed',
  'placementLocked',
])
const serializedResponse = JSON.stringify(responseJson)
for (const secret of [participantAToken, participantBToken, creationTokens.invitationToken]) {
  assert(!serializedResponse.includes(secret))
}
for (const forbidden of [
  'authTokenHash',
  'inviteTokenHash',
  'claimedAt',
  'placementLockedAt',
  'bombBag',
  'coinBag',
  'DATABASE_URL',
]) {
  assert(!serializedResponse.includes(forbidden))
}

const unavailableHandler = createGetDuelMatchHandler(async () => {
  throw new GetDuelMatchError()
})
for (const request of [
  apiRequest({ authorization: 'Bearer invalid' }),
  apiRequest({ id: otherMatchId }),
  apiRequest({ id: 'invalid' }),
]) {
  const unavailable = await unavailableHandler(request)
  assert.equal(unavailable.status, 404)
  assert.equal(unavailable.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await unavailable.json(), {
    error: { code: 'match_unavailable' },
  })
}

const expiredHandler = createGetDuelMatchHandler(async () => {
  throw new GetDuelMatchError()
})
const expiredResponse = await expiredHandler(apiRequest())
assert.equal(expiredResponse.status, 404)
assert.deepEqual(await expiredResponse.json(), {
  error: { code: 'match_unavailable' },
})

const methodResponse = await successHandler(apiRequest({ method: 'POST' }))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'GET')
assert.equal(methodResponse.headers.get('cache-control'), 'no-store')

const internalHandler = createGetDuelMatchHandler(async () => {
  throw new Error('sensitive database detail')
})
const internalResponse = await internalHandler(apiRequest())
assert.equal(internalResponse.status, 500)
const internalJson = await internalResponse.json()
assert.deepEqual(internalJson, {
  error: { code: 'internal_error' },
})
assert(!JSON.stringify(internalJson).includes('sensitive'))

console.log('verify:duel-get OK')
