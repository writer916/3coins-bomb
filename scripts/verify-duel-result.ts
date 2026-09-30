/** Server-only DUEL final result, secrecy boundary and HTTP checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createGetDuelResultHandler } from '../api/duel/matches/[matchId]/result'
import {
  aggregateDuelParticipantResult,
  compareDuelParticipantResults,
  DuelResultDataError,
  type DuelParticipantResultSummary,
  type DuelResultRole,
} from '../server/duel/duelResult'
import { getDuelResult, validateGetDuelResultRequest } from '../server/duel/getResult'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = `3cb_pa1_${'a'.repeat(42)}A`

const placement = (
  roundNumber: number,
  coinBagNumbers: readonly number[],
  bombBagNumber = 4,
) => ({ roundNumber, bagCount: 4, bombBagNumber, coinBagNumbers })

const clearRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
) => ({
  roundNumber,
  placementRole,
  endReason: 'cleared' as const,
  capturedCoins: 3,
  bombHit: false,
  openedBagCount: bags.length,
  opens: bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber })),
})

const stacked = aggregateDuelParticipantResult({
  role: 'A',
  totalRounds: 3,
  opponentPlacements: [
    placement(1, [1, 1, 1]),
    placement(2, [1, 1, 2]),
    placement(3, [1, 2, 3]),
  ],
  rounds: [
    clearRound(1, 'B', [1]),
    clearRound(2, 'B', [1, 2]),
    clearRound(3, 'B', [1, 2, 3]),
  ],
})
assert.equal(stacked.totalCapturedCoins, 9)
assert.equal(stacked.coinBagHits, 6, '1/2/3 coin bags must each count as one hit')
assert.equal(stacked.totalOpens, 6)

const emptyBomb = aggregateDuelParticipantResult({
  role: 'B',
  totalRounds: 1,
  opponentPlacements: [placement(1, [1, 1, 2], 4)],
  rounds: [{
    roundNumber: 1,
    placementRole: 'A',
    endReason: 'bombed',
    capturedCoins: 0,
    bombHit: true,
    openedBagCount: 2,
    opens: [
      { openOrder: 1, bagNumber: 3 },
      { openOrder: 2, bagNumber: 4 },
    ],
  }],
})
assert.equal(emptyBomb.coinBagHits, 0, 'EMPTY and BOMB must not count as hits')
assert.equal(emptyBomb.totalOpens, 2)

function summary(
  role: DuelResultRole,
  coins: number,
  hits: number,
  opens: number,
): DuelParticipantResultSummary {
  return {
    role,
    totalCapturedCoins: coins,
    coinBagHits: hits,
    totalOpens: opens,
    hitRate: { numerator: hits, denominator: opens },
    rounds: [],
  }
}

assert.equal(
  compareDuelParticipantResults(summary('A', 8, 1, 10), summary('B', 6, 9, 10)),
  'A',
  'TOTAL COINS must override hit rate',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 5, 10), summary('B', 6, 4, 10)),
  'A',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 2, 5), summary('B', 6, 1, 2)),
  'B',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 2, 3), summary('B', 6, 4, 6)),
  'draw',
  'equivalent fractions must draw without percentage rounding',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 1, 2), summary('B', 6, 2, 5)),
  'A',
  'strict cross-product comparison must be used',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 3, 6), summary('B', 6, 5, 10)),
  'draw',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 2, 4), summary('B', 6, 1, 2)),
  'draw',
  'total opens alone must not break an equal hit-rate tie',
)
assert.throws(
  () => compareDuelParticipantResults(summary('A', 0, 0, 0), summary('B', 0, 0, 1)),
  DuelResultDataError,
)
assert.throws(() => aggregateDuelParticipantResult({
  role: 'A',
  totalRounds: 1,
  opponentPlacements: [placement(1, [1, 1, 2])],
  rounds: [{ ...clearRound(1, 'B', [1, 2]), openedBagCount: 1 }],
}), DuelResultDataError)

const validated = validateGetDuelResultRequest(MATCH_ID, `Bearer ${TOKEN}`)
assert.equal(validated.matchId, MATCH_ID)
await assert.rejects(
  getDuelResult(validated, { getResult: async () => null }),
  /unavailable/i,
)

const waiting = {
  matchId: MATCH_ID,
  status: 'waiting' as const,
  selfCompleted: true,
  opponentCompleted: false,
}
const waitingHandler = createGetDuelResultHandler(async () => waiting)
const waitingResponse = await waitingHandler(new Request(
  `https://example.test/api/duel/matches/${MATCH_ID}/result`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
))
assert.equal(waitingResponse.status, 200)
assert.equal(waitingResponse.headers.get('cache-control'), 'no-store')
const waitingJson = await waitingResponse.json() as Record<string, unknown>
assert.deepEqual(Object.keys(waitingJson).sort(), [
  'matchId', 'opponentCompleted', 'selfCompleted', 'status',
])
for (const secret of [
  'totalCapturedCoins', 'coinBagHits', 'totalOpens', 'hitRate', 'rounds',
  'placements', 'progress', 'playedRounds',
]) assert.equal(JSON.stringify(waitingJson).includes(secret), false)

const completed = {
  matchId: MATCH_ID,
  status: 'completed' as const,
  viewerRole: 'A' as const,
  totalRounds: 1,
  winner: 'draw' as const,
  participants: {
    A: summary('A', 3, 1, 1),
    B: summary('B', 3, 1, 1),
  },
}
for (const role of ['A', 'B'] as const) {
  const handler = createGetDuelResultHandler(async () => ({ ...completed, viewerRole: role }))
  const response = await handler(new Request(
    `https://example.test/api/duel/matches/${MATCH_ID}/result`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  ))
  assert.equal(response.status, 200)
  const json = await response.json() as typeof completed
  assert.equal(json.viewerRole, role)
  assert.equal(json.winner, 'draw')
  assert.deepEqual(json.participants, completed.participants)
}

const methodResponse = await waitingHandler(new Request(
  `https://example.test/api/duel/matches/${MATCH_ID}/result`,
  { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } },
))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('cache-control'), 'no-store')

const [dbSource, pureSource] = await Promise.all([
  readFile(new URL('../server/db/getDuelResult.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/duel/duelResult.ts', import.meta.url), 'utf8'),
])
assert.match(dbSource, /with candidate as materialized/)
assert.match(dbSource, /where completion\.both_completed/)
assert.match(dbSource, /coinBagNumbers/)
assert.doesNotMatch(pureSource, /Math\.round|toFixed|percentage|roundWins|bombedRoundCount/)
assert.match(pureSource, /a\.coinBagHits \* b\.totalOpens/)
assert.match(pureSource, /b\.coinBagHits \* a\.totalOpens/)

console.log('verify:duel-result OK')
