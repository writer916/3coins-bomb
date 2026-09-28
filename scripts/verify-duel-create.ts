/** DUEL match creation service/API checks. No token or secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDuelMatchesHandler } from '../api/duel/matches.ts'
import {
  CreateDuelMatchError,
  DUEL_CREATE_BODY_MAX_BYTES,
  createDuelMatch,
  validateCreateDuelMatchInput,
  type CreateDuelMatchResponse,
} from '../server/duel/createMatch.ts'
import type {
  PersistDuelMatchInput,
  PersistedDuelMatch,
} from '../server/db/createDuelMatch.ts'
import {
  DUEL_TOKEN_HMAC_KEY_ENV,
  deriveMatchCreationTokens,
  hashDuelToken,
} from '../server/auth/duelTokens.ts'

const root = resolve(import.meta.dirname, '..')
const requestId = '550e8400-e29b-41d4-a716-446655440000'
const otherRequestId = '650e8400-e29b-41d4-a716-446655440000'
const recoverySecret = Buffer.alloc(32, 0x31).toString('base64url')
const otherRecoverySecret = Buffer.alloc(32, 0x32).toString('base64url')
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64url'),
}

function expectCreateCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof CreateDuelMatchError)
    assert.equal(error.code, code)
    assert(!error.message.includes(recoverySecret))
    return true
  })
}

function validInput(totalRounds: number) {
  return validateCreateDuelMatchInput(requestId, {
    totalRounds,
    createRecoverySecret: recoverySecret,
  })
}

assert.equal(validInput(1).totalRounds, 1)
assert.equal(validInput(20).totalRounds, 20)
expectCreateCode(() => validInput(0), 'INVALID_REQUEST')
expectCreateCode(() => validInput(21), 'INVALID_REQUEST')
expectCreateCode(
  () =>
    validateCreateDuelMatchInput('invalid', {
      totalRounds: 5,
      createRecoverySecret: recoverySecret,
    }),
  'INVALID_REQUEST',
)
expectCreateCode(
  () =>
    validateCreateDuelMatchInput(requestId, {
      totalRounds: 5,
      createRecoverySecret: 'invalid',
    }),
  'INVALID_REQUEST',
)
expectCreateCode(
  () =>
    validateCreateDuelMatchInput(requestId, {
      totalRounds: 5,
      createRecoverySecret: recoverySecret,
      role: 'A',
    }),
  'INVALID_REQUEST',
)
expectCreateCode(() => validateCreateDuelMatchInput(requestId, []), 'INVALID_REQUEST')

interface StoredMatch {
  readonly input: PersistDuelMatchInput
  readonly match: Omit<PersistedDuelMatch, 'created'>
}

const stored = new Map<string, StoredMatch>()
let creationCount = 0
const capturedWrites: PersistDuelMatchInput[] = []

async function memoryPersist(
  input: PersistDuelMatchInput,
): Promise<PersistedDuelMatch | null> {
  capturedWrites.push(input)
  const existing = stored.get(input.createRequestId)
  if (existing) {
    if (
      existing.input.totalRounds !== input.totalRounds ||
      existing.input.participantTokenHash !== input.participantTokenHash ||
      existing.input.invitationTokenHash !== input.invitationTokenHash
    ) {
      return null
    }
    return { ...existing.match, created: false }
  }

  creationCount += 1
  const match = {
    matchId: `00000000-0000-4000-8000-${String(creationCount).padStart(12, '0')}`,
    totalRounds: input.totalRounds,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    formationVersion: 1 as const,
    ruleVersion: 1 as const,
  }
  stored.set(input.createRequestId, { input, match })
  return { ...match, created: true }
}

const dependencies = {
  deriveTokens: (input: {
    readonly createRequestId: string
    readonly createRecoverySecret: string
  }) => deriveMatchCreationTokens(input, fixtureEnvironment),
  persist: memoryPersist,
}

const first = await createDuelMatch(validInput(5), dependencies)
assert.equal(first.created, true)
assert.equal(first.response.totalRounds, 5)
assert.equal(first.response.participant.role, 'A')
assert.equal(first.response.expiresAt, null)
assert.equal(first.response.formationVersion, 1)
assert.equal(first.response.ruleVersion, 1)
assert.equal(creationCount, 1)
assert.match(capturedWrites[0].participantTokenHash, /^[0-9a-f]{64}$/)
assert.match(capturedWrites[0].invitationTokenHash, /^[0-9a-f]{64}$/)
assert.equal(
  capturedWrites[0].participantTokenHash,
  hashDuelToken(first.response.participant.token),
)
assert.equal(
  capturedWrites[0].invitationTokenHash,
  hashDuelToken(first.response.invitation.token),
)

const retried = await createDuelMatch(validInput(5), dependencies)
assert.equal(retried.created, false)
assert.equal(retried.response.matchId, first.response.matchId)
assert.deepEqual(retried.response, first.response)
assert.equal(creationCount, 1)

await assert.rejects(
  createDuelMatch({ ...validInput(5), totalRounds: 6 }, dependencies),
  (error: unknown) =>
    error instanceof CreateDuelMatchError &&
    error.code === 'CREATE_REQUEST_CONFLICT',
)
await assert.rejects(
  createDuelMatch(
    { ...validInput(5), createRecoverySecret: otherRecoverySecret },
    dependencies,
  ),
  (error: unknown) =>
    error instanceof CreateDuelMatchError &&
    error.code === 'CREATE_REQUEST_CONFLICT',
)

const concurrent = await Promise.all(
  Array.from({ length: 8 }, () =>
    createDuelMatch(
      validateCreateDuelMatchInput(otherRequestId, {
        totalRounds: 8,
        createRecoverySecret: recoverySecret,
      }),
      dependencies,
    ),
  ),
)
assert.equal(new Set(concurrent.map((result) => result.response.matchId)).size, 1)
assert.equal(concurrent.filter((result) => result.created).length, 1)
assert.equal(creationCount, 2)

const persistenceSource = readFileSync(
  resolve(root, 'server/db/createDuelMatch.ts'),
  'utf8',
).toLowerCase()
assert.equal((persistenceSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(persistenceSource.includes('with match_row as'))
assert(persistenceSource.includes('participant_a as'))
assert(persistenceSource.includes('participant_b as'))
assert.equal((persistenceSource.match(/insert into duel_matches/g) ?? []).length, 1)
assert.equal((persistenceSource.match(/insert into duel_participants/g) ?? []).length, 2)
assert(persistenceSource.includes("'a'"))
assert(persistenceSource.includes("'b'"))
assert(persistenceSource.includes('statement_timestamp()'))
assert(persistenceSource.includes('expires_at'))
assert(persistenceSource.includes('null'))
assert(persistenceSource.includes('formation_version'))
assert(persistenceSource.includes('rule_version'))
assert(!persistenceSource.includes('.transaction('))

const apiResponse: CreateDuelMatchResponse = first.response
const createdHandler = createDuelMatchesHandler(async () => ({
  created: true,
  response: apiResponse,
}))
const retryHandler = createDuelMatchesHandler(async () => ({
  created: false,
  response: apiResponse,
}))

function apiRequest(
  body: unknown,
  options: { idempotencyKey?: string; method?: string } = {},
): Request {
  return new Request('https://example.test/api/duel/matches', {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.idempotencyKey === undefined
        ? { 'Idempotency-Key': requestId }
        : { 'Idempotency-Key': options.idempotencyKey }),
    },
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  })
}

const createdResponse = await createdHandler(
  apiRequest({ totalRounds: 5, createRecoverySecret: recoverySecret }),
)
assert.equal(createdResponse.status, 201)
assert.equal(createdResponse.headers.get('cache-control'), 'no-store')
const createdJson = (await createdResponse.json()) as Record<string, unknown>
assert.deepEqual(Object.keys(createdJson).sort(), [
  'createdAt',
  'expiresAt',
  'formationVersion',
  'invitation',
  'matchId',
  'participant',
  'ruleVersion',
  'totalRounds',
])
assert(!JSON.stringify(createdJson).includes(recoverySecret))
assert(!JSON.stringify(createdJson).toLowerCase().includes('tokenhash'))

const retryResponse = await retryHandler(
  apiRequest({ totalRounds: 5, createRecoverySecret: recoverySecret }),
)
assert.equal(retryResponse.status, 200)
assert.equal(retryResponse.headers.get('cache-control'), 'no-store')

const conflictHandler = createDuelMatchesHandler(async () => {
  throw new CreateDuelMatchError('CREATE_REQUEST_CONFLICT')
})
const conflictResponse = await conflictHandler(
  apiRequest({ totalRounds: 5, createRecoverySecret: recoverySecret }),
)
assert.equal(conflictResponse.status, 409)
assert.deepEqual(await conflictResponse.json(), {
  error: { code: 'create_request_conflict' },
})
assert.equal(conflictResponse.headers.get('cache-control'), 'no-store')

const invalidResponse = await createdHandler(
  apiRequest({ totalRounds: 0, createRecoverySecret: recoverySecret }),
)
assert.equal(invalidResponse.status, 400)
assert.deepEqual(await invalidResponse.json(), {
  error: { code: 'invalid_request' },
})

const oversizedResponse = await createdHandler(
  apiRequest({
    totalRounds: 5,
    createRecoverySecret: 'x'.repeat(DUEL_CREATE_BODY_MAX_BYTES),
  }),
)
assert.equal(oversizedResponse.status, 400)

const malformedResponse = await createdHandler(
  new Request('https://example.test/api/duel/matches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId,
    },
    body: '{',
  }),
)
assert.equal(malformedResponse.status, 400)

const wrongContentTypeResponse = await createdHandler(
  new Request('https://example.test/api/duel/matches', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Idempotency-Key': requestId,
    },
    body: '{}',
  }),
)
assert.equal(wrongContentTypeResponse.status, 400)

const methodResponse = await createdHandler(apiRequest({}, { method: 'GET' }))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'POST')

const internalHandler = createDuelMatchesHandler(async () => {
  throw new Error('sensitive database detail')
})
const internalResponse = await internalHandler(
  apiRequest({ totalRounds: 5, createRecoverySecret: recoverySecret }),
)
assert.equal(internalResponse.status, 500)
assert.deepEqual(await internalResponse.json(), {
  error: { code: 'internal_error' },
})

console.log('verify:duel-create OK')
