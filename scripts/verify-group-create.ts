/** GROUP creation service/API checks. No capability or secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGroupMatchesHandler } from '../api/_group/matches.ts'
import {
  GROUP_HOST_TOKEN_PREFIX,
  GROUP_INVITATION_TOKEN_PREFIX,
  deriveGroupCreationCapabilities,
  hashGroupCapability,
} from '../server/auth/groupTokens.ts'
import type {
  PersistedGroupMatch,
  PersistGroupMatchInput,
} from '../server/db/createGroupMatch.ts'
import {
  CreateGroupMatchError,
  GROUP_CREATE_BODY_MAX_BYTES,
  createGroupMatch,
  validateCreateGroupMatchInput,
  type CreateGroupMatchResponse,
} from '../server/group/createMatch.ts'
import {
  createGeneratedGroupPlacementProvider,
  createServerCryptoRandomSource,
} from '../server/group/groupPlacementProvider.ts'
import { DUEL_TOKEN_HMAC_KEY_ENV } from '../server/auth/duelTokens.ts'

const root = resolve(import.meta.dirname, '..')
const requestId = '550e8400-e29b-41d4-a716-446655440000'
const otherRequestId = '650e8400-e29b-41d4-a716-446655440000'
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x47).toString('base64url'),
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof CreateGroupMatchError)
    assert.equal(error.code, code)
    return true
  })
}

assert.deepEqual(validateCreateGroupMatchInput(requestId, {
  totalRounds: 1,
  playerLimit: 2,
}), { createRequestId: requestId, totalRounds: 1, playerLimit: 2 })
assert.equal(validateCreateGroupMatchInput(requestId, {
  totalRounds: 20,
  playerLimit: 20,
}).totalRounds, 20)
for (const invalid of [0, 21, 1.5, '3']) {
  expectCode(
    () => validateCreateGroupMatchInput(requestId, {
      totalRounds: invalid,
      playerLimit: 2,
    }),
    'INVALID_REQUEST',
  )
}
for (const invalid of [1, 21, 2.5, '4']) {
  expectCode(
    () => validateCreateGroupMatchInput(requestId, {
      totalRounds: 2,
      playerLimit: invalid,
    }),
    'INVALID_REQUEST',
  )
}
expectCode(
  () => validateCreateGroupMatchInput('invalid', { totalRounds: 2, playerLimit: 2 }),
  'INVALID_REQUEST',
)
expectCode(
  () => validateCreateGroupMatchInput(requestId, {
    totalRounds: 2,
    playerLimit: 2,
    nickname: 'host',
  }),
  'INVALID_REQUEST',
)
expectCode(() => validateCreateGroupMatchInput(requestId, []), 'INVALID_REQUEST')

const firstCapabilities = deriveGroupCreationCapabilities(requestId, fixtureEnvironment)
const retriedCapabilities = deriveGroupCreationCapabilities(requestId, fixtureEnvironment)
const otherCapabilities = deriveGroupCreationCapabilities(otherRequestId, fixtureEnvironment)
assert.deepEqual(firstCapabilities, retriedCapabilities)
assert.notDeepEqual(firstCapabilities, otherCapabilities)
assert.match(
  firstCapabilities.invitationToken,
  new RegExp(`^${GROUP_INVITATION_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`),
)
assert.match(
  firstCapabilities.hostToken,
  new RegExp(`^${GROUP_HOST_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`),
)
assert.notEqual(firstCapabilities.invitationToken, firstCapabilities.hostToken)
assert.match(hashGroupCapability(firstCapabilities.invitationToken), /^[0-9a-f]{64}$/)

const cryptoRandom = createServerCryptoRandomSource()
for (let index = 0; index < 64; index += 1) {
  const sample = cryptoRandom.next()
  assert(sample >= 0 && sample < 1)
}
const generated = createGeneratedGroupPlacementProvider().provide(20)
assert.equal(generated.length, 20)
for (const [index, candidate] of generated.entries()) {
  const placement = candidate.placement
  assert.equal(candidate.origin, 'generated')
  assert.equal(placement.roundNumber, index + 1)
  assert(placement.bagCount >= 3 && placement.bagCount <= 8)
  assert.equal(placement.coinBagNumbers.length, 3)
  assert.deepEqual(
    placement.coinBagNumbers,
    [...placement.coinBagNumbers].sort((a, b) => a - b),
  )
  assert(!placement.coinBagNumbers.includes(placement.bombBagNumber))
}

const fixedPlacements = createGeneratedGroupPlacementProvider({
  next: () => 0,
}).provide(2)
interface Stored {
  readonly input: PersistGroupMatchInput
  readonly match: Omit<PersistedGroupMatch, 'created'>
}
const stored = new Map<string, Stored>()
let creationCount = 0
const writes: PersistGroupMatchInput[] = []
async function memoryPersist(
  input: PersistGroupMatchInput,
): Promise<PersistedGroupMatch | null> {
  writes.push(input)
  const existing = stored.get(input.createRequestId)
  if (existing) {
    if (
      existing.input.totalRounds !== input.totalRounds ||
      existing.input.playerLimit !== input.playerLimit ||
      existing.input.invitationTokenHash !== input.invitationTokenHash ||
      existing.input.hostTokenHash !== input.hostTokenHash
    ) return null
    return { ...existing.match, created: false }
  }
  creationCount += 1
  const match = {
    groupId: `00000000-0000-4000-8000-${String(creationCount).padStart(12, '0')}`,
    totalRounds: input.totalRounds,
    playerLimit: input.playerLimit,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    formationVersion: 1 as const,
    ruleVersion: 1 as const,
    scoringVersion: 1 as const,
  }
  stored.set(input.createRequestId, { input, match })
  return { ...match, created: true }
}
const dependencies = {
  deriveCapabilities: (id: string) =>
    deriveGroupCreationCapabilities(id, fixtureEnvironment),
  placementProvider: { provide: () => fixedPlacements },
  persist: memoryPersist,
}

const input = validateCreateGroupMatchInput(requestId, {
  totalRounds: 2,
  playerLimit: 4,
})
const first = await createGroupMatch(input, dependencies)
assert.equal(first.created, true)
assert.equal(first.response.totalRounds, 2)
assert.equal(first.response.playerLimit, 4)
assert.equal(first.response.expiresAt, null)
assert.equal(first.response.formationVersion, 1)
assert.equal(first.response.ruleVersion, 1)
assert.equal(first.response.scoringVersion, 1)
assert.equal(writes[0]?.placements.length, 2)
assert.equal(writes[0]?.placements.every(({ origin }) => origin === 'generated'), true)
assert.equal(writes[0]?.invitationTokenHash, hashGroupCapability(first.response.invitation.token))
assert.equal(writes[0]?.hostTokenHash, hashGroupCapability(first.response.host.token))

const retried = await createGroupMatch(input, dependencies)
assert.equal(retried.created, false)
assert.deepEqual(retried.response, first.response)
assert.equal(creationCount, 1)
await assert.rejects(
  createGroupMatch({ ...input, playerLimit: 5 }, dependencies),
  (error: unknown) =>
    error instanceof CreateGroupMatchError &&
    error.code === 'CREATE_REQUEST_CONFLICT',
)

const persistenceSource = readFileSync(
  resolve(root, 'server/db/createGroupMatch.ts'),
  'utf8',
).toLowerCase()
assert.equal((persistenceSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert.equal((persistenceSource.match(/insert into group_matches/g) ?? []).length, 1)
assert.equal((persistenceSource.match(/insert into group_round_placements/g) ?? []).length, 1)
assert(persistenceSource.includes('with match_row as materialized'))
assert(persistenceSource.includes('inserted_placements'))
assert(persistenceSource.includes('placement_integrity'))
assert(!persistenceSource.includes('.transaction('))
assert(persistenceSource.includes('invite_token_hash'))
assert(persistenceSource.includes('host_token_hash'))

const apiResponse: CreateGroupMatchResponse = first.response
const createdHandler = createGroupMatchesHandler(async () => ({
  created: true,
  response: apiResponse,
}))
const retryHandler = createGroupMatchesHandler(async () => ({
  created: false,
  response: apiResponse,
}))
function request(
  body: unknown,
  options: { method?: string; idempotencyKey?: string } = {},
): Request {
  return new Request('https://example.test/api/group/matches', {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': options.idempotencyKey ?? requestId,
    },
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  })
}
const createdResponse = await createdHandler(request({ totalRounds: 2, playerLimit: 4 }))
assert.equal(createdResponse.status, 201)
assert.equal(createdResponse.headers.get('cache-control'), 'no-store')
const json = (await createdResponse.json()) as Record<string, unknown>
assert.deepEqual(Object.keys(json).sort(), [
  'createdAt', 'expiresAt', 'formationVersion', 'groupId', 'host',
  'invitation', 'playerLimit', 'ruleVersion', 'scoringVersion', 'totalRounds',
].sort())
const serialized = JSON.stringify(json).toLowerCase()
assert(!serialized.includes('hash'))
assert(!serialized.includes('createRequestId'.toLowerCase()))
assert.equal((await retryHandler(request({ totalRounds: 2, playerLimit: 4 }))).status, 200)

const conflictHandler = createGroupMatchesHandler(async () => {
  throw new CreateGroupMatchError('CREATE_REQUEST_CONFLICT')
})
assert.equal((await conflictHandler(request({ totalRounds: 2, playerLimit: 4 }))).status, 409)
assert.equal((await createdHandler(request({ totalRounds: 0, playerLimit: 4 }))).status, 400)
assert.equal((await createdHandler(request({ totalRounds: 2, playerLimit: 4 }, { method: 'GET' }))).status, 405)
assert.equal((await createdHandler(new Request('https://example.test/api/group/matches', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': requestId },
  body: '{}',
}))).status, 400)
assert.equal((await createdHandler(new Request('https://example.test/api/group/matches', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
  body: '{',
}))).status, 400)
assert.equal((await createdHandler(request({
  totalRounds: 2,
  playerLimit: 4,
  padding: 'x'.repeat(GROUP_CREATE_BODY_MAX_BYTES),
}))).status, 400)
const internalHandler = createGroupMatchesHandler(async () => {
  throw new Error('sensitive database detail')
})
const internal = await internalHandler(request({ totalRounds: 2, playerLimit: 4 }))
assert.equal(internal.status, 500)
assert.deepEqual(await internal.json(), { error: { code: 'internal_error' } })

console.log('verify:group-create OK')
