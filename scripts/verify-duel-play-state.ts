/** DUEL server-only play-state recovery checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetPlayStateHandler } from '../api/_duel/matches/[matchId]/play.ts'
import {
  GetPlayStateError,
  getPlayState,
  validateGetPlayStateRequest,
} from '../server/duel/getPlayState.ts'
import type { PersistedDuelPlayState } from '../server/db/getDuelPlayState.ts'
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

const requestA = validateGetPlayStateRequest(
  matchId,
  `Bearer ${participantAToken}`,
)
assert.deepEqual(requestA, { matchId, participantToken: participantAToken })
assert(!Object.hasOwn(requestA, 'role'))

function expectUnavailable(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof GetPlayStateError)
    assert.equal(error.code, 'MATCH_UNAVAILABLE')
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}
expectUnavailable(() => validateGetPlayStateRequest('invalid', `Bearer ${participantAToken}`))
expectUnavailable(() => validateGetPlayStateRequest(matchId, 'Bearer invalid'))
expectUnavailable(() => validateGetPlayStateRequest(matchId, null))

const noOpenState: PersistedDuelPlayState = {
  matchId,
  role: 'A',
  totalRounds: 3,
  participantCompleted: false,
  nextPlayableRoundNumber: 1,
  selfProgress: { completedRounds: 0, totalCapturedCoins: 0, threeCoinsComplete: 0 },
  activeRound: {
    roundNumber: 1,
    bagCount: 5,
    openedBags: [],
    provisionalCoins: 0,
    nextOpenOrder: 1,
  },
  latestTerminalRound: null,
}

let receivedHash = ''
const recovered = await getPlayState(requestA, {
  getState: async (input) => {
    receivedHash = input.participantTokenHash
    return noOpenState
  },
})
assert.deepEqual(recovered, noOpenState)
assert.equal(receivedHash, hashDuelToken(participantAToken))
assert(!Object.hasOwn(recovered, 'participantToken'))
assert(!Object.hasOwn(recovered, 'opponent'))

await assert.rejects(
  getPlayState(requestA, { getState: async () => null }),
  (error: unknown) => error instanceof GetPlayStateError,
)
await assert.rejects(
  getPlayState(
    { matchId: otherMatchId, participantToken: participantAToken },
    { getState: async () => null },
  ),
  (error: unknown) => error instanceof GetPlayStateError,
)

const activeRecovery: PersistedDuelPlayState = {
  matchId,
  role: 'A',
  totalRounds: 5,
  participantCompleted: false,
  nextPlayableRoundNumber: 3,
  selfProgress: { completedRounds: 2, totalCapturedCoins: 3, threeCoinsComplete: 1 },
  activeRound: {
    roundNumber: 3,
    bagCount: 6,
    openedBags: [
      { bagNumber: 2, openOrder: 1, outcome: 'empty', coinsFound: 0 },
      { bagNumber: 5, openOrder: 2, outcome: 'coins', coinsFound: 2 },
    ],
    provisionalCoins: 2,
    nextOpenOrder: 3,
  },
  latestTerminalRound: {
    roundNumber: 2,
    bagCount: 4,
    openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 3 }],
    endReason: 'cleared',
    capturedCoins: 3,
    openedBagCount: 1,
  },
}
const active = await getPlayState(requestA, { getState: async () => activeRecovery })
assert.deepEqual(active.activeRound?.openedBags.map((bag) => bag.openOrder), [1, 2])
assert.equal(active.activeRound?.provisionalCoins, 2)
assert.equal(active.activeRound?.nextOpenOrder, 3)
assert.equal(active.latestTerminalRound?.endReason, 'cleared')
assert.deepEqual(active.selfProgress, {
  completedRounds: 2,
  totalCapturedCoins: 3,
  threeCoinsComplete: 1,
})

const terminalCases: PersistedDuelPlayState['latestTerminalRound'][] = [
  {
    roundNumber: 3,
    bagCount: 5,
    openedBags: [
      { bagNumber: 2, openOrder: 1, outcome: 'coins', coinsFound: 1 },
      { bagNumber: 4, openOrder: 2, outcome: 'bomb', coinsFound: 0 },
    ],
    endReason: 'bombed',
    capturedCoins: 0,
    openedBagCount: 2,
  },
  {
    roundNumber: 3,
    bagCount: 5,
    openedBags: [{ bagNumber: 2, openOrder: 1, outcome: 'coins', coinsFound: 3 }],
    endReason: 'cleared',
    capturedCoins: 3,
    openedBagCount: 1,
  },
  {
    roundNumber: 3,
    bagCount: 5,
    openedBags: [{ bagNumber: 2, openOrder: 1, outcome: 'coins', coinsFound: 2 }],
    endReason: 'cashed_out',
    capturedCoins: 2,
    openedBagCount: 1,
  },
]
for (const latestTerminalRound of terminalCases) {
  const terminalReload: PersistedDuelPlayState = {
    matchId,
    role: 'B',
    totalRounds: 5,
    participantCompleted: false,
    nextPlayableRoundNumber: 4,
    selfProgress: { completedRounds: 3, totalCapturedCoins: latestTerminalRound.capturedCoins, threeCoinsComplete: 0 },
    activeRound: {
      roundNumber: 4,
      bagCount: 7,
      openedBags: [],
      provisionalCoins: 0,
      nextOpenOrder: 1,
    },
    latestTerminalRound,
  }
  const state = await getPlayState(
    { matchId, participantToken: participantBToken },
    { getState: async () => terminalReload },
  )
  assert.equal(state.activeRound?.roundNumber, 4)
  assert.equal(state.latestTerminalRound?.roundNumber, 3)
}

const completed: PersistedDuelPlayState = {
  matchId,
  role: 'A',
  totalRounds: 1,
  participantCompleted: true,
  nextPlayableRoundNumber: null,
  selfProgress: { completedRounds: 1, totalCapturedCoins: 0, threeCoinsComplete: 0 },
  activeRound: null,
  latestTerminalRound: terminalCases[0],
}
assert.deepEqual(
  await getPlayState(requestA, { getState: async () => completed }),
  completed,
)

const dbSource = readFileSync(
  resolve(root, 'server/db/getDuelPlayState.ts'),
  'utf8',
).toLowerCase()
assert.equal((dbSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(dbSource.includes('with candidate as materialized'))
assert(dbSource.includes('three_coins_complete'))
assert(dbSource.includes("end_reason = 'cleared'"))
assert(dbSource.includes('self.claimed_at is not null'))
assert(dbSource.includes('self.placement_locked_at is not null'))
assert(dbSource.includes('opponent.claimed_at is not null'))
assert(dbSource.includes('opponent.placement_locked_at is not null'))
assert(dbSource.includes('match.expires_at > statement_timestamp()'))
assert(dbSource.includes('results_contiguous'))
assert(dbSource.includes('sum(result.captured_coins)'))
assert(dbSource.includes('opens_contiguous'))
assert(dbSource.includes("round_kind = 'active'"))
assert(dbSource.includes('found_coins between 0 and 2'))
assert(dbSource.includes("end_reason = 'cashed_out'"))
assert(dbSource.includes("'openedbags'"))
assert(!dbSource.includes('select placement.*'))
assert(!dbSource.includes('delete from'))
assert(!dbSource.includes('.transaction('))

const handler = createGetPlayStateHandler(async () => activeRecovery)
function apiRequest(options: {
  method?: string
  authorization?: string
  id?: string
} = {}): Request {
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/play`,
    {
      method: options.method ?? 'GET',
      headers: {
        Authorization: options.authorization ?? `Bearer ${participantAToken}`,
      },
    },
  )
}

const response = await handler(apiRequest())
assert.equal(response.status, 200)
assert.equal(response.headers.get('cache-control'), 'no-store')
const responseJson = await response.json()
assert.deepEqual(responseJson, activeRecovery)
const serialized = JSON.stringify(responseJson)
for (const forbidden of [
  participantAToken,
  participantBToken,
  tokens.invitationToken,
  'bombBagNumber',
  'coinBagNumbers',
  'remainingCoins',
  'participantTokenHash',
  'opponent',
  'opponentCompletedRounds',
  'opponentTotalCapturedCoins',
]) {
  assert(!serialized.includes(forbidden))
}

const unavailableHandler = createGetPlayStateHandler(async () => {
  throw new GetPlayStateError()
})
const unavailable = await unavailableHandler(apiRequest())
assert.equal(unavailable.status, 404)
assert.deepEqual(await unavailable.json(), { error: { code: 'match_unavailable' } })

const internalHandler = createGetPlayStateHandler(async () => {
  throw new Error('database detail that must not escape')
})
const internal = await internalHandler(apiRequest())
assert.equal(internal.status, 500)
const internalJson = await internal.json()
assert.deepEqual(internalJson, { error: { code: 'internal_error' } })
assert(!JSON.stringify(internalJson).includes('database detail'))

const method = await handler(apiRequest({ method: 'POST' }))
assert.equal(method.status, 405)
assert.equal(method.headers.get('allow'), 'GET')

const existingGetSource = readFileSync(
  resolve(root, 'server/db/getDuelMatch.ts'),
  'utf8',
)
assert(!existingGetSource.includes('openedBags'))
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
assert.equal(
  packageJson.scripts['verify:duel-play-state'],
  'tsx scripts/verify-duel-play-state.ts',
)

console.log('verify:duel-play-state OK')
