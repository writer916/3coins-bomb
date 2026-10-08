/** Server-only DUEL final result, secrecy boundary and HTTP checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createGetDuelResultHandler } from '../api/_duel/matches/[matchId]/result'
import {
  aggregateDuelParticipantResult,
  compareDuelParticipantResults,
  DuelResultDataError,
  pairDuelParticipantResults,
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

const cashRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
  coins: 1 | 2,
) => ({
  roundNumber,
  placementRole,
  endReason: 'cashed_out' as const,
  capturedCoins: coins,
  bombHit: false,
  openedBagCount: bags.length,
  opens: bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber })),
})

const bombRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
) => ({
  roundNumber,
  placementRole,
  endReason: 'bombed' as const,
  capturedCoins: 0,
  bombHit: true,
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
assert.equal(stacked.threeCoinsComplete, 3)
assert.equal(stacked.bombsHit, 0, 'aggregate alone cannot know placer bombs-hit')
assert.equal(stacked.coinBagHits, 6, '1/2/3 coin bags must each count as one hit')
assert.equal(stacked.totalOpens, 6)

const mixed = aggregateDuelParticipantResult({
  role: 'A',
  totalRounds: 3,
  opponentPlacements: [
    placement(1, [1, 2, 3]),
    placement(2, [1, 1, 2]),
    placement(3, [1, 2, 3]),
  ],
  rounds: [
    clearRound(1, 'B', [1, 2, 3]),
    cashRound(2, 'B', [1], 2),
    clearRound(3, 'B', [1, 2, 3]),
  ],
})
assert.equal(mixed.totalCapturedCoins, 8)
assert.equal(mixed.threeCoinsComplete, 2, 'only cleared rounds count as 3COINS COMPLETE')

const emptyBomb = aggregateDuelParticipantResult({
  role: 'B',
  totalRounds: 1,
  opponentPlacements: [placement(1, [1, 1, 2], 4)],
  rounds: [bombRound(1, 'A', [3, 4])],
})
assert.equal(emptyBomb.coinBagHits, 0, 'EMPTY and BOMB must not count as hits')
assert.equal(emptyBomb.totalOpens, 2)
assert.equal(emptyBomb.threeCoinsComplete, 0)

// A bombed on B's layout twice; B cleared once — placer bombs-hit is cross-role.
const aExplorer = aggregateDuelParticipantResult({
  role: 'A',
  totalRounds: 2,
  opponentPlacements: [placement(1, [1, 2, 3]), placement(2, [1, 2, 3])],
  rounds: [
    bombRound(1, 'B', [4]),
    clearRound(2, 'B', [1, 2, 3]),
  ],
})
const bExplorer = aggregateDuelParticipantResult({
  role: 'B',
  totalRounds: 2,
  opponentPlacements: [placement(1, [1, 2, 3]), placement(2, [1, 2, 3])],
  rounds: [
    bombRound(1, 'A', [4]),
    bombRound(2, 'A', [3, 4]),
  ],
})
const paired = pairDuelParticipantResults(aExplorer, bExplorer)
assert.equal(paired.A.bombsHit, 2, "A's BOMBS HIT = B stepped on A's bomb twice")
assert.equal(paired.B.bombsHit, 1, "B's BOMBS HIT = A stepped on B's bomb once")
assert.equal(paired.A.threeCoinsComplete, 1)
assert.equal(paired.B.threeCoinsComplete, 0)
assert.equal(
  compareDuelParticipantResults(paired.A, paired.B),
  'A',
  'equal coins: more 3COINS COMPLETE wins',
)

function summary(
  role: DuelResultRole,
  coins: number,
  completes: number,
  bombs: number,
  hits: number,
  opens: number,
): DuelParticipantResultSummary {
  return {
    role,
    totalCapturedCoins: coins,
    threeCoinsComplete: completes,
    bombsHit: bombs,
    coinBagHits: hits,
    totalOpens: opens,
    hitRate: { numerator: hits, denominator: opens },
    rounds: Array.from({ length: Math.max(completes, bombs) }, (_, index) => ({
      roundNumber: index + 1,
      endReason: index < completes ? 'cleared' as const : 'bombed' as const,
      capturedCoins: (index < completes ? 3 : 0) as 0 | 3,
      openedBagCount: 1,
    })),
  }
}

assert.equal(
  compareDuelParticipantResults(summary('A', 8, 0, 0, 1, 10), summary('B', 6, 9, 9, 9, 10)),
  'A',
  'TOTAL COINS must override completes and bombs',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 2, 0, 1, 10), summary('B', 6, 1, 9, 9, 10)),
  'A',
  '3COINS COMPLETE must override BOMBS HIT and legacy hit rate',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 1, 2, 1, 10), summary('B', 6, 1, 1, 9, 10)),
  'A',
  'BOMBS HIT breaks ties after completes',
)
assert.equal(
  compareDuelParticipantResults(summary('A', 6, 1, 1, 9, 10), summary('B', 6, 1, 1, 1, 10)),
  'draw',
  'hit rate must not break ties anymore',
)
assert.throws(
  () => compareDuelParticipantResults(summary('A', 0, 0, 0, 0, 0), summary('B', 0, 0, 0, 0, 1)),
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
  'totalCapturedCoins', 'threeCoinsComplete', 'bombsHit',
  'coinBagHits', 'totalOpens', 'hitRate', 'rounds',
  'placements', 'progress', 'playedRounds',
]) assert.equal(JSON.stringify(waitingJson).includes(secret), false)

const completed = {
  matchId: MATCH_ID,
  status: 'completed' as const,
  viewerRole: 'A' as const,
  totalRounds: 1,
  winner: 'draw' as const,
  participants: {
    A: summary('A', 3, 1, 0, 1, 1),
    B: summary('B', 3, 1, 0, 1, 1),
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
assert.match(dbSource, /pairDuelParticipantResults/)
assert.match(pureSource, /threeCoinsComplete/)
assert.match(pureSource, /bombsHit/)
assert.match(pureSource, /TOTAL COINS → 3COINS COMPLETE → BOMBS HIT/)
assert.doesNotMatch(pureSource, /aRateProduct|bRateProduct/)

console.log('verify:duel-result OK')
