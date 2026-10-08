/** DUEL all-ROUND placement LOCK checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createLockPlacementsHandler } from '../api/_duel/matches/[matchId]/placements/lock.ts'
import {
  LockPlacementsError,
  lockPlacements,
  validateLockPlacementsRequest,
  type LockPlacementsRequest,
} from '../server/duel/lockPlacements.ts'
import type {
  CanonicalDuelRoundPlacement,
  LockDuelPlacementsInput,
  LockDuelPlacementsResult,
} from '../server/db/lockDuelPlacements.ts'
import { getDuelMatch } from '../server/duel/getMatch.ts'
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
const tokens = deriveMatchCreationTokens(
  {
    createRequestId: matchId,
    createRecoverySecret: Buffer.alloc(32, 0x41).toString('base64url'),
  },
  fixtureEnvironment,
)
const participantAToken = tokens.participantToken
const participantBToken = deriveParticipantBToken(
  {
    matchId,
    invitationToken: tokens.invitationToken,
    claimRecoverySecret: Buffer.alloc(32, 0x42).toString('base64url'),
  },
  fixtureEnvironment,
)

const inputPlacements = [
  {
    roundNumber: 2,
    bagCount: 5,
    bombBagNumber: 4,
    coinBagNumbers: [5, 1, 1],
  },
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagNumber: 2,
    coinBagNumbers: [3, 1, 1],
  },
]

function requestBody(placements: readonly unknown[] = inputPlacements) {
  return { placements }
}

const requestA = validateLockPlacementsRequest(
  matchId,
  `Bearer ${participantAToken}`,
  requestBody(),
)
assert.deepEqual(requestA.placements, [
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagNumber: 2,
    coinBagNumbers: [1, 1, 3],
  },
  {
    roundNumber: 2,
    bagCount: 5,
    bombBagNumber: 4,
    coinBagNumbers: [1, 1, 5],
  },
])

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof LockPlacementsError)
    assert.equal(error.code, code)
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}

expectCode(
  () => validateLockPlacementsRequest('invalid', `Bearer ${participantAToken}`, requestBody()),
  'MATCH_UNAVAILABLE',
)
expectCode(
  () => validateLockPlacementsRequest(matchId, 'Bearer invalid', requestBody()),
  'MATCH_UNAVAILABLE',
)
/* Promoted B may authenticate with the invitation token format; DB hash decides role. */
assert.equal(
  validateLockPlacementsRequest(
    matchId,
    `Bearer ${tokens.invitationToken}`,
    requestBody(),
  ).participantToken,
  tokens.invitationToken,
)

const invalidBodies: unknown[] = [
  {},
  { placements: [] },
  { placements: inputPlacements, role: 'A' },
  requestBody([inputPlacements[0], inputPlacements[0]]),
  requestBody([{ ...inputPlacements[0], roundNumber: 3 }]),
  requestBody([{ ...inputPlacements[1], bagCount: 2 }]),
  requestBody([{ ...inputPlacements[1], bagCount: 9 }]),
  requestBody([{ ...inputPlacements[1], bombBagNumber: 0 }]),
  requestBody([{ ...inputPlacements[1], bombBagNumber: 4 }]),
  requestBody([{ ...inputPlacements[1], coinBagNumbers: [1, 3] }]),
  requestBody([{ ...inputPlacements[1], coinBagNumbers: [1, 1, 1, 3] }]),
  requestBody([{ ...inputPlacements[1], coinBagNumbers: [1, 2, 3] }]),
  requestBody([{ ...inputPlacements[1], coinBagNumbers: [1, 1, 4] }]),
  requestBody([{ ...inputPlacements[1], coinBagNumbers: [1, 1, 2.5] }]),
]
for (const body of invalidBodies) {
  expectCode(
    () => validateLockPlacementsRequest(matchId, `Bearer ${participantAToken}`, body),
    'INVALID_REQUEST',
  )
}

interface MemoryParticipant {
  readonly role: 'A' | 'B'
  readonly tokenHash: string
  locked: boolean
  placements: CanonicalDuelRoundPlacement[]
}

function canonicalJson(placements: readonly CanonicalDuelRoundPlacement[]): string {
  return JSON.stringify(placements)
}

function memoryPersistence(options: { expired?: boolean } = {}) {
  const participants: Record<'A' | 'B', MemoryParticipant> = {
    A: {
      role: 'A',
      tokenHash: hashDuelToken(participantAToken),
      locked: false,
      placements: [],
    },
    B: {
      role: 'B',
      tokenHash: hashDuelToken(participantBToken),
      locked: false,
      placements: [],
    },
  }
  let writeCount = 0
  const persist = async (
    input: LockDuelPlacementsInput,
  ): Promise<LockDuelPlacementsResult> => {
    if (options.expired || input.matchId !== matchId) {
      return { status: 'unavailable' }
    }
    const participant = Object.values(participants).find(
      (candidate) => candidate.tokenHash === input.participantTokenHash,
    )
    if (!participant) return { status: 'unavailable' }
    if (participant.locked) {
      return canonicalJson(participant.placements) === canonicalJson(input.placements)
        ? { status: 'retry', role: participant.role }
        : { status: 'conflict', role: participant.role }
    }
    if (input.placements.length !== 2) return { status: 'invalid', role: participant.role }
    participant.placements = input.placements.map((placement) => ({
      ...placement,
      coinBagNumbers: [...placement.coinBagNumbers] as [number, number, number],
    }))
    participant.locked = true
    writeCount += 1
    return { status: 'locked', role: participant.role }
  }
  return { participants, persist, get writeCount() { return writeCount } }
}

const memory = memoryPersistence()
const aLocked = await lockPlacements(requestA, { persist: memory.persist })
assert.deepEqual(aLocked, { matchId, role: 'A', placementLocked: true })
assert.equal(memory.participants.A.placements.length, 2)
assert.equal(memory.participants.A.locked, true)
assert.equal(memory.writeCount, 1)

const sameRetry = await lockPlacements(requestA, { persist: memory.persist })
assert.deepEqual(sameRetry, aLocked)
assert.equal(memory.writeCount, 1)

const reorderedCoinRequest = validateLockPlacementsRequest(
  matchId,
  `Bearer ${participantAToken}`,
  requestBody([
    { ...inputPlacements[1], coinBagNumbers: [1, 3, 1] },
    { ...inputPlacements[0], coinBagNumbers: [1, 5, 1] },
  ]),
)
const reorderedRetry = await lockPlacements(reorderedCoinRequest, {
  persist: memory.persist,
})
assert.deepEqual(reorderedRetry, aLocked)
assert.equal(memory.writeCount, 1)

const differentRequest: LockPlacementsRequest = {
  ...requestA,
  placements: requestA.placements.map((placement, index) =>
    index === 0
      ? { ...placement, coinBagNumbers: [1, 3, 3] as const }
      : placement,
  ),
}
await assert.rejects(
  lockPlacements(differentRequest, { persist: memory.persist }),
  (error: unknown) =>
    error instanceof LockPlacementsError && error.code === 'PLACEMENT_CONFLICT',
)
assert.equal(memory.writeCount, 1)
assert.deepEqual(memory.participants.A.placements, requestA.placements)

const requestB = validateLockPlacementsRequest(
  matchId,
  `Bearer ${participantBToken}`,
  requestBody(),
)
const bLocked = await lockPlacements(requestB, { persist: memory.persist })
assert.deepEqual(bLocked, { matchId, role: 'B', placementLocked: true })
assert.equal(memory.participants.B.placements.length, 2)

const stateAfterLock = await getDuelMatch(
  { matchId, participantToken: participantAToken },
  {
    getMatch: async () => ({
      matchId,
      totalRounds: 2,
      role: 'A',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      formationVersion: 1,
      ruleVersion: 1,
      self: { claimed: true, placementLocked: memory.participants.A.locked },
      opponent: { claimed: true, placementLocked: memory.participants.B.locked },
    }),
  },
)
assert.equal(stateAfterLock.self.placementLocked, true)
assert.equal(stateAfterLock.opponent.placementLocked, true)

const shortMemory = memoryPersistence()
await assert.rejects(
  lockPlacements(
    { ...requestA, placements: requestA.placements.slice(0, 1) },
    { persist: shortMemory.persist },
  ),
  (error: unknown) =>
    error instanceof LockPlacementsError && error.code === 'INVALID_REQUEST',
)
assert.equal(shortMemory.writeCount, 0)
assert.equal(shortMemory.participants.A.placements.length, 0)
assert.equal(shortMemory.participants.A.locked, false)

const longMemory = memoryPersistence()
const thirdPlacement: CanonicalDuelRoundPlacement = {
  ...requestA.placements[1],
  roundNumber: 3,
}
await assert.rejects(
  lockPlacements(
    { ...requestA, placements: [...requestA.placements, thirdPlacement] },
    { persist: longMemory.persist },
  ),
  (error: unknown) =>
    error instanceof LockPlacementsError && error.code === 'INVALID_REQUEST',
)
assert.equal(longMemory.writeCount, 0)

const expiredMemory = memoryPersistence({ expired: true })
await assert.rejects(
  lockPlacements(requestA, { persist: expiredMemory.persist }),
  (error: unknown) =>
    error instanceof LockPlacementsError && error.code === 'MATCH_UNAVAILABLE',
)
assert.equal(expiredMemory.writeCount, 0)

await assert.rejects(
  lockPlacements(
    { ...requestA, matchId: otherMatchId },
    { persist: memoryPersistence().persist },
  ),
  (error: unknown) =>
    error instanceof LockPlacementsError && error.code === 'MATCH_UNAVAILABLE',
)

const persistenceSource = readFileSync(
  resolve(root, 'server/db/lockDuelPlacements.ts'),
  'utf8',
).toLowerCase()
assert.equal((persistenceSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(persistenceSource.includes('with candidate as materialized'))
assert(persistenceSource.includes('for update of participant'))
assert(persistenceSource.includes('insert into duel_round_placements'))
assert(persistenceSource.includes('update duel_participants'))
assert(persistenceSource.includes('placement_locked_at = statement_timestamp()'))
assert(persistenceSource.includes('(select count(*) from inserted) = candidate.total_rounds'))
assert(persistenceSource.includes('stored.coin_bag_numbers = incoming.coin_bag_numbers'))
assert(persistenceSource.includes('match.expires_at > statement_timestamp()'))
assert(!persistenceSource.includes('delete from'))
assert(!persistenceSource.includes('.transaction('))

const handler = createLockPlacementsHandler(async () => ({
  matchId,
  role: 'A',
  placementLocked: true,
}))
function apiRequest(
  body: unknown = requestBody(),
  options: { authorization?: string; method?: string; id?: string } = {},
): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/placements/lock`,
    {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.authorization ?? `Bearer ${participantAToken}`,
      },
      body: options.method === 'GET' ? undefined : JSON.stringify(body),
    },
  )
}

const successResponse = await handler(apiRequest())
assert.equal(successResponse.status, 200)
assert.equal(successResponse.headers.get('cache-control'), 'no-store')
const successJson = await successResponse.json()
assert.deepEqual(successJson, { matchId, role: 'A', placementLocked: true })
const serialized = JSON.stringify(successJson)
for (const forbidden of [
  participantAToken,
  participantBToken,
  tokens.invitationToken,
  'bombBagNumber',
  'coinBagNumbers',
  'authTokenHash',
]) {
  assert(!serialized.includes(forbidden))
}

const invalidTokenResponse = await handler(
  apiRequest(requestBody(), { authorization: 'Bearer invalid' }),
)
assert.equal(invalidTokenResponse.status, 404)
assert.deepEqual(await invalidTokenResponse.json(), {
  error: { code: 'match_unavailable' },
})

const conflictHandler = createLockPlacementsHandler(async () => {
  throw new LockPlacementsError('PLACEMENT_CONFLICT')
})
const conflictResponse = await conflictHandler(apiRequest())
assert.equal(conflictResponse.status, 409)
assert.deepEqual(await conflictResponse.json(), {
  error: { code: 'placement_conflict' },
})

const methodResponse = await handler(apiRequest(undefined, { method: 'GET' }))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'POST')

console.log('verify:duel-lock OK')
