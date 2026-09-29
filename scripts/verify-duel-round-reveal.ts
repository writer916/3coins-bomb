/** DUEL server-only ROUND REVEAL checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetRoundRevealHandler } from '../api/duel/matches/[matchId]/rounds/[roundNumber]/reveal.ts'
import {
  toPersistedDuelRoundReveal,
  type PersistedDuelRoundReveal,
} from '../server/db/getDuelRoundReveal.ts'
import {
  GetRoundRevealError,
  getRoundReveal,
  validateGetRoundRevealRequest,
} from '../server/duel/getRoundReveal.ts'
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

const requestA = validateGetRoundRevealRequest(
  matchId,
  2,
  `Bearer ${participantAToken}`,
)
assert.deepEqual(requestA, {
  matchId,
  participantToken: participantAToken,
  roundNumber: 2,
})
assert(!Object.hasOwn(requestA, 'role'))

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof GetRoundRevealError)
    assert.equal(error.code, code)
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}
expectCode(
  () => validateGetRoundRevealRequest(matchId, 0, `Bearer ${participantAToken}`),
  'INVALID_REQUEST',
)
expectCode(
  () => validateGetRoundRevealRequest(matchId, 21, `Bearer ${participantAToken}`),
  'INVALID_REQUEST',
)
expectCode(
  () => validateGetRoundRevealRequest('invalid', 1, `Bearer ${participantAToken}`),
  'MATCH_UNAVAILABLE',
)
expectCode(
  () => validateGetRoundRevealRequest(matchId, 1, 'Bearer invalid'),
  'MATCH_UNAVAILABLE',
)

const reveal: PersistedDuelRoundReveal = {
  matchId,
  roundNumber: 2,
  bagCount: 5,
  bags: [
    { bagNumber: 1, contents: { kind: 'coins', coinCount: 1 } },
    { bagNumber: 2, contents: { kind: 'coins', coinCount: 2 } },
    { bagNumber: 3, contents: { kind: 'empty' } },
    { bagNumber: 4, contents: { kind: 'empty' } },
    { bagNumber: 5, contents: { kind: 'bomb' } },
  ],
}

let receivedHash = ''
assert.deepEqual(
  await getRoundReveal(requestA, {
    getReveal: async (input) => {
      receivedHash = input.participantTokenHash
      assert.equal(input.roundNumber, 2)
      return reveal
    },
  }),
  reveal,
)
assert.equal(receivedHash, hashDuelToken(participantAToken))
for (const token of [participantAToken, participantBToken]) {
  const result = await getRoundReveal(
    { matchId, participantToken: token, roundNumber: 2 },
    { getReveal: async () => reveal },
  )
  assert.deepEqual(result, reveal)
}
await assert.rejects(
  getRoundReveal(requestA, { getReveal: async () => null }),
  (error: unknown) =>
    error instanceof GetRoundRevealError && error.code === 'MATCH_UNAVAILABLE',
)
await assert.rejects(
  getRoundReveal(
    { ...requestA, matchId: otherMatchId },
    { getReveal: async () => null },
  ),
  GetRoundRevealError,
)

function placement(
  coinBagNumbers: readonly number[],
  bombBagNumber = 5,
  bagCount = 5,
) {
  return {
    match_id: matchId,
    round_number: 2,
    bag_count: bagCount,
    bomb_bag_number: bombBagNumber,
    coin_bag_numbers: coinBagNumbers,
  }
}

const converted = toPersistedDuelRoundReveal(placement([1, 2, 2]))
assert.deepEqual(converted, reveal)
assert.equal(converted.bags.length, converted.bagCount)
assert.deepEqual(converted.bags.map((bag) => bag.bagNumber), [1, 2, 3, 4, 5])
assert.equal(converted.bags.filter((bag) => bag.contents.kind === 'empty').length, 2)
assert.equal(converted.bags.filter((bag) => bag.contents.kind === 'bomb').length, 1)
assert.equal(
  converted.bags.reduce(
    (sum, bag) => sum + (bag.contents.kind === 'coins' ? bag.contents.coinCount : 0),
    0,
  ),
  3,
)
assert.deepEqual(
  toPersistedDuelRoundReveal(placement([1, 1, 1])).bags[0]?.contents,
  { kind: 'coins', coinCount: 3 },
)
assert.deepEqual(
  toPersistedDuelRoundReveal(placement([1, 2, 3])).bags
    .filter((bag) => bag.contents.kind === 'coins')
    .map((bag) => bag.contents),
  [
    { kind: 'coins', coinCount: 1 },
    { kind: 'coins', coinCount: 1 },
    { kind: 'coins', coinCount: 1 },
  ],
)

for (const malformed of [
  placement([1, 2], 5),
  placement([1, 2, 3, 4], 5),
  placement([1, 2, 5], 5),
  placement([2, 1, 2], 5),
  placement([1, 2, 6], 5),
  placement([1, 2, 3], 0),
  placement([1, 2, 3], 5, 2),
  { ...placement([1, 2, 3]), coin_bag_numbers: [1, 2, '3'] },
]) {
  assert.throws(
    () => toPersistedDuelRoundReveal(malformed),
    /placement is inconsistent/,
  )
}

const dbSource = readFileSync(
  resolve(root, 'server/db/getDuelRoundReveal.ts'),
  'utf8',
).toLowerCase()
assert.equal((dbSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(dbSource.includes('self.auth_token_hash'))
assert(dbSource.includes('self.claimed_at is not null'))
assert(dbSource.includes('self.placement_locked_at is not null'))
assert(dbSource.includes('opponent.claimed_at is not null'))
assert(dbSource.includes('opponent.placement_locked_at is not null'))
assert(dbSource.includes('match.expires_at > statement_timestamp()'))
assert(dbSource.includes('inner join duel_round_results settled'))
assert(dbSource.includes('settled.explorer_role = self.role'))
assert(dbSource.includes('settled.placement_role = opponent.role'))
assert(dbSource.includes('settled.round_number ='))
assert(dbSource.includes('placement.participant_role = opponent.role'))
assert(dbSource.includes('placement.round_number = settled.round_number'))
assert(!dbSource.includes('duel_round_opens'))
assert(!dbSource.includes('select placement.*'))
assert(!dbSource.includes('delete from'))
assert(!dbSource.includes('update duel_'))

const handler = createGetRoundRevealHandler(async () => reveal)
function apiRequest(options: {
  method?: string
  id?: string
  round?: string
  authorization?: string
} = {}): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/rounds/${options.round ?? '2'}/reveal`,
    {
      method: options.method ?? 'GET',
      headers: {
        Authorization: options.authorization ?? `Bearer ${participantAToken}`,
      },
    },
  )
}

const success = await handler(apiRequest())
assert.equal(success.status, 200)
assert.equal(success.headers.get('cache-control'), 'no-store')
const successJson = await success.json()
assert.deepEqual(successJson, reveal)
const serialized = JSON.stringify(successJson)
for (const forbidden of [
  participantAToken,
  participantBToken,
  tokens.invitationToken,
  'authTokenHash',
  'participantTokenHash',
  'bombBagNumber',
  'coinBagNumbers',
  'explorerRole',
  'placementRole',
  'openedBags',
  'requestId',
]) {
  assert(!serialized.includes(forbidden))
}

assert.equal((await handler(apiRequest({ round: '0' }))).status, 400)
const method = await handler(apiRequest({ method: 'POST' }))
assert.equal(method.status, 405)
assert.equal(method.headers.get('allow'), 'GET')

const unavailableHandler = createGetRoundRevealHandler(async () => {
  throw new GetRoundRevealError('MATCH_UNAVAILABLE')
})
const unavailable = await unavailableHandler(apiRequest())
assert.equal(unavailable.status, 404)
assert.deepEqual(await unavailable.json(), { error: { code: 'match_unavailable' } })

const internalHandler = createGetRoundRevealHandler(async () => {
  throw new Error('database detail that must not escape')
})
const internal = await internalHandler(apiRequest())
assert.equal(internal.status, 500)
assert.deepEqual(await internal.json(), { error: { code: 'internal_error' } })

const playDbSource = readFileSync(
  resolve(root, 'server/db/getDuelPlayState.ts'),
  'utf8',
)
const playRouteSource = readFileSync(
  resolve(root, 'api/duel/matches/[matchId]/play.ts'),
  'utf8',
)
for (const source of [playDbSource, playRouteSource]) {
  assert(!source.includes('DuelRevealBag'))
  assert(!source.includes('coinBagNumbers'))
  assert(!source.includes('bombBagNumber'))
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
assert.equal(
  packageJson.scripts['verify:duel-round-reveal'],
  'tsx scripts/verify-duel-round-reveal.ts',
)

console.log('verify:duel-round-reveal OK')
