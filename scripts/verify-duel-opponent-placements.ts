/** DUEL READY opponent placement endpoint checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetOpponentPlacementsHandler } from '../api/_duel/matches/[matchId]/opponent-placements.ts'
import {
  toPersistedDuelOpponentPlacements,
  type DuelOpponentPlacementRecord,
  type PersistedDuelOpponentPlacements,
} from '../server/db/getDuelOpponentPlacements.ts'
import {
  GetOpponentPlacementsError,
  getOpponentPlacements,
  validateGetOpponentPlacementsRequest,
} from '../server/duel/getOpponentPlacements.ts'
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

const responseA: PersistedDuelOpponentPlacements = {
  matchId,
  role: 'A',
  totalRounds: 2,
  formationVersion: 1,
  ruleVersion: 1,
  placements: [
    { roundNumber: 1, bagCount: 4, bombBagNumber: 4, coinBagNumbers: [1, 2, 2] },
    { roundNumber: 2, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [1, 1, 1] },
  ],
}
const responseB: PersistedDuelOpponentPlacements = { ...responseA, role: 'B' }

const requestA = validateGetOpponentPlacementsRequest(
  matchId,
  `Bearer ${participantAToken}`,
)
const requestB = validateGetOpponentPlacementsRequest(
  matchId,
  `Bearer ${participantBToken}`,
)
assert.deepEqual(requestA, { matchId, participantToken: participantAToken })
assert.deepEqual(requestB, { matchId, participantToken: participantBToken })
assert(!Object.hasOwn(requestA, 'role'))

for (const invalid of [undefined, '', 'Bearer invalid', 'Basic invalid']) {
  assert.throws(
    () => validateGetOpponentPlacementsRequest(matchId, invalid),
    GetOpponentPlacementsError,
  )
}
assert.throws(
  () => validateGetOpponentPlacementsRequest('invalid', `Bearer ${participantAToken}`),
  GetOpponentPlacementsError,
)

let receivedHash = ''
assert.deepEqual(
  await getOpponentPlacements(requestA, {
    getPlacements: async (input) => {
      receivedHash = input.participantTokenHash
      return responseA
    },
  }),
  responseA,
)
assert.equal(receivedHash, hashDuelToken(participantAToken))
assert.deepEqual(
  await getOpponentPlacements(requestB, { getPlacements: async () => responseB }),
  responseB,
)
for (const request of [requestA, { ...requestA, matchId: otherMatchId }]) {
  await assert.rejects(
    getOpponentPlacements(request, { getPlacements: async () => null }),
    GetOpponentPlacementsError,
  )
}

function row(
  roundNumber: number | null,
  options: Partial<DuelOpponentPlacementRecord> = {},
): DuelOpponentPlacementRecord {
  return {
    match_id: matchId,
    role: 'A',
    total_rounds: 2,
    formation_version: 1,
    rule_version: 1,
    round_number: roundNumber,
    bag_count: 4,
    bomb_bag_number: 4,
    coin_bag_numbers: [1, 2, 2],
    ...options,
  }
}
const converted = toPersistedDuelOpponentPlacements([
  row(1),
  row(2, { bag_count: 5, bomb_bag_number: 5, coin_bag_numbers: [1, 1, 1] }),
])
assert.deepEqual(converted, responseA)
assert.deepEqual(converted?.placements.map((item) => item.roundNumber), [1, 2])
assert.deepEqual(converted?.placements[0]?.coinBagNumbers, [1, 2, 2])
assert.equal(toPersistedDuelOpponentPlacements([]), null)

for (const malformed of [
  [row(1)],
  [row(2), row(1)],
  [row(1), row(3)],
  [row(1), row(2, { coin_bag_numbers: [1, 2] })],
  [row(1), row(2, { coin_bag_numbers: [2, 1, 2] })],
  [row(1), row(2, { coin_bag_numbers: [1, 2, 4] })],
  [row(1), row(2, { bag_count: 2 })],
  [row(1), row(2, { bomb_bag_number: 0 })],
  [row(1), row(2, { round_number: null, bag_count: null })],
]) {
  assert.throws(
    () => toPersistedDuelOpponentPlacements(malformed),
    /placements are inconsistent/,
  )
}

const dbSource = readFileSync(
  resolve(root, 'server/db/getDuelOpponentPlacements.ts'),
  'utf8',
).toLowerCase()
assert.equal((dbSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
for (const required of [
  'self.auth_token_hash',
  'self.claimed_at is not null',
  'self.placement_locked_at is not null',
  'opponent.claimed_at is not null',
  'opponent.placement_locked_at is not null',
  'match.expires_at > statement_timestamp()',
  'placement.participant_role = opponent.role',
  'order by placement.round_number',
]) assert(dbSource.includes(required), required)
assert(!dbSource.includes('placement.participant_role = self.role'))
assert(!dbSource.includes('select placement.*'))
assert(!dbSource.includes('delete from'))
assert(!dbSource.includes('update duel_'))

function apiRequest(options: {
  method?: string
  id?: string
  authorization?: string
} = {}): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/opponent-placements`,
    {
      method: options.method ?? 'GET',
      headers: options.authorization === undefined
        ? { Authorization: `Bearer ${participantAToken}` }
        : { Authorization: options.authorization },
    },
  )
}

const handlerA = createGetOpponentPlacementsHandler(async () => responseA)
const success = await handlerA(apiRequest())
assert.equal(success.status, 200)
assert.equal(success.headers.get('cache-control'), 'no-store')
assert.deepEqual(await success.json(), responseA)
const serialized = JSON.stringify(responseA)
for (const forbidden of [
  participantAToken,
  participantBToken,
  tokens.invitationToken,
  'authTokenHash',
  'participantTokenHash',
  'inviteTokenHash',
  'claimedAt',
  'placementLockedAt',
  'opponentRole',
]) assert(!serialized.includes(forbidden))

const method = await handlerA(apiRequest({ method: 'POST' }))
assert.equal(method.status, 405)
assert.equal(method.headers.get('allow'), 'GET')
assert.equal(method.headers.get('cache-control'), 'no-store')

const unavailableHandler = createGetOpponentPlacementsHandler(async () => {
  throw new GetOpponentPlacementsError()
})
for (const request of [
  apiRequest({ authorization: '' }),
  apiRequest({ authorization: 'Bearer invalid' }),
  apiRequest({ id: otherMatchId }),
]) {
  const unavailable = await unavailableHandler(request)
  assert.equal(unavailable.status, 404)
  assert.deepEqual(await unavailable.json(), { error: { code: 'match_unavailable' } })
}

const internalHandler = createGetOpponentPlacementsHandler(async () => {
  throw new Error('sensitive database detail')
})
const internal = await internalHandler(apiRequest())
assert.equal(internal.status, 500)
assert.deepEqual(await internal.json(), { error: { code: 'internal_error' } })

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
assert.equal(
  packageJson.scripts['verify:duel-opponent-placements'],
  'tsx scripts/verify-duel-opponent-placements.ts',
)

console.log('verify:duel-opponent-placements OK')
