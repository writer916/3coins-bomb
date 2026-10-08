/**
 * Cross-mode BOMB confirmed-coins rule + ranking priority regressions.
 * BOMB forfeits provisional coins → ROUND confirmed = 0; TOTAL sums confirmed only.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHiddenHand } from '../src/game/hand.ts'
import {
  applyOpenBag,
  createActiveRound,
  tryCashOut,
} from '../src/game/round.ts'
import {
  aggregateGroupParticipantResult,
  compareGroupParticipantScores,
  GroupDomainValidationError,
  rankGroupParticipants,
  type GroupParticipantResultSummary,
  type GroupRoundPlacement,
} from '../src/group/groupDomain.ts'
import {
  compareDuelParticipantResults,
  type DuelParticipantResultSummary,
} from '../server/duel/duelResult.ts'
import { parseGroupOpenResult } from '../src/group/groupPlayClient.ts'

const root = resolve(import.meta.dirname, '..')
const accepted = (second: number) =>
  `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`

/* --- SOLO: bomb confirmed = 0 --- */
{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-2', 'bag-3'],
  })
  let round = createActiveRound(hand)
  const openedCoin = applyOpenBag(round, 'bag-1')
  assert.equal(openedCoin.ok, true)
  if (!openedCoin.ok) throw new Error('coin open failed')
  round = openedCoin.state
  assert.ok(round.provisionalCoins >= 1)
  const openedBomb = applyOpenBag(round, 'bag-5')
  assert.equal(openedBomb.ok, true)
  if (!openedBomb.ok) throw new Error('bomb open failed')
  round = openedBomb.state
  assert.equal(round.phase, 'bombed')
  assert.equal(round.capturedCoins, 0)
  assert.equal(round.provisionalCoins, 0)
}

/* SOLO cash-out confirms provisional */
{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-2', 'bag-3'],
  })
  let round = createActiveRound(hand)
  const opened = applyOpenBag(round, 'bag-1')
  assert.equal(opened.ok, true)
  if (!opened.ok) throw new Error('coin open failed')
  round = opened.state
  if (round.provisionalCoins === 1 || round.provisionalCoins === 2) {
    const cashed = tryCashOut(round)
    assert.equal(cashed.ok, true)
    if (!cashed.ok) throw new Error('cash out failed')
    assert.equal(cashed.state.capturedCoins, round.provisionalCoins)
  }
}

/* --- GROUP domain: bomb cases + screenshot TOTAL --- */
const placement = (
  roundNumber: number,
  coins: readonly [number, number, number] = [1, 2, 3],
): GroupRoundPlacement => ({
  roundNumber,
  bagCount: 4,
  bombBagNumber: 4,
  coinBagNumbers: coins,
})

function groupRound(
  endReason: 'bombed' | 'cashed_out' | 'cleared' | 'interrupted',
  capturedCoins: number,
  bags: readonly number[],
  coins: readonly [number, number, number] = [1, 2, 3],
) {
  return aggregateGroupParticipantResult({
    participantId: 'p',
    acceptedAt: accepted(0),
    totalRounds: 1,
    placements: [placement(1, coins)],
    rounds: [
      {
        roundNumber: 1,
        endReason,
        capturedCoins,
        opens: bags.map((bagNumber, index) => ({
          openOrder: index + 1,
          bagNumber,
        })),
      },
    ],
  })
}

assert.equal(groupRound('bombed', 0, [4]).totalCapturedCoins, 0)
assert.equal(groupRound('bombed', 0, [1, 4]).totalCapturedCoins, 0)
assert.equal(groupRound('bombed', 0, [1, 2, 4]).totalCapturedCoins, 0)
assert.equal(groupRound('cashed_out', 1, [1]).totalCapturedCoins, 1)
assert.equal(groupRound('cashed_out', 2, [1, 2]).totalCapturedCoins, 2)
assert.equal(groupRound('cleared', 3, [1, 2, 3]).totalCapturedCoins, 3)
assert.throws(() => groupRound('bombed', 1, [1, 4]), GroupDomainValidationError)
assert.throws(() => groupRound('bombed', 2, [1, 2, 4]), GroupDomainValidationError)

const shot = aggregateGroupParticipantResult({
  participantId: 'shot',
  acceptedAt: accepted(0),
  totalRounds: 3,
  placements: [placement(1), placement(2), placement(3)],
  rounds: [
    {
      roundNumber: 1,
      endReason: 'bombed',
      capturedCoins: 0,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 4 },
      ],
    },
    {
      roundNumber: 2,
      endReason: 'cleared',
      capturedCoins: 3,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 2 },
        { openOrder: 3, bagNumber: 3 },
      ],
    },
    {
      roundNumber: 3,
      endReason: 'cleared',
      capturedCoins: 3,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 2 },
        { openOrder: 3, bagNumber: 3 },
      ],
    },
  ],
})
assert.equal(shot.totalCapturedCoins, 6)
assert.equal(shot.threeCoinsComplete, 2)
assert.equal(shot.rounds[0]?.capturedCoins, 0)
assert.ok(shot.coinBagHits >= 1, 'BOMB round coin-bag opens remain in HIT RATE')

assert.throws(() =>
  aggregateGroupParticipantResult({
    participantId: 'over-open',
    acceptedAt: accepted(0),
    totalRounds: 1,
    placements: [placement(1)],
    rounds: [
      {
        roundNumber: 1,
        endReason: 'cleared',
        capturedCoins: 3,
        opens: [
          { openOrder: 1, bagNumber: 1 },
          { openOrder: 2, bagNumber: 2 },
          { openOrder: 3, bagNumber: 3 },
          { openOrder: 4, bagNumber: 4 },
        ],
      },
    ],
  }),
  GroupDomainValidationError,
)

/* --- GROUP ranking: TOTAL → COMPLETE → HIT RATE; competition ranks --- */
function gSummary(
  id: string,
  coins: number,
  completes: number,
  hits: number,
  opens: number,
  at = accepted(0),
): GroupParticipantResultSummary {
  return {
    participantId: id,
    acceptedAt: at,
    totalCapturedCoins: coins,
    threeCoinsComplete: completes,
    coinBagHits: hits,
    totalOpens: opens,
    hitRate: { numerator: hits, denominator: opens },
    rounds: Array.from({ length: Math.max(1, completes) }, (_, i) => ({
      roundNumber: i + 1,
      endReason: i < completes ? 'cleared' : 'interrupted',
      capturedCoins: i < completes ? 3 : 0,
      openedBagCount: 0,
      coinBagHits: 0,
    })),
  }
}
assert.ok(compareGroupParticipantScores(gSummary('a', 9, 0, 0, 1), gSummary('b', 8, 3, 9, 9)) < 0)
assert.ok(compareGroupParticipantScores(gSummary('a', 9, 2, 0, 1), gSummary('b', 9, 1, 9, 9)) < 0)
assert.ok(compareGroupParticipantScores(gSummary('a', 9, 1, 2, 3), gSummary('b', 9, 1, 1, 3)) < 0)
assert.equal(compareGroupParticipantScores(gSummary('a', 9, 1, 2, 3), gSummary('b', 9, 1, 4, 6)), 0)
const ranked = rankGroupParticipants([
  gSummary('late', 10, 1, 1, 2, accepted(9)),
  gSummary('early', 10, 1, 1, 2, accepted(1)),
  gSummary('third', 8, 0, 0, 1, accepted(2)),
])
assert.deepEqual(
  ranked.map((entry) => [entry.participantId, entry.rank]),
  [
    ['early', 1],
    ['late', 1],
    ['third', 3],
  ],
)
assert.equal(
  compareGroupParticipantScores(
    gSummary('late', 10, 1, 1, 2, accepted(9)),
    gSummary('early', 10, 1, 1, 2, accepted(1)),
  ),
  0,
  'accepted_at must not affect score order',
)

/* --- DUEL ranking: TOTAL → COMPLETE → BOMBS HIT (returns winner role / draw) --- */
function dSummary(
  role: 'A' | 'B',
  coins: number,
  completes: number,
  bombs: number,
  hits = 0,
  opens = 1,
): DuelParticipantResultSummary {
  return {
    role,
    totalCapturedCoins: coins,
    threeCoinsComplete: completes,
    bombsHit: bombs,
    coinBagHits: hits,
    totalOpens: opens,
    hitRate: { numerator: hits, denominator: opens },
    rounds: Array.from({ length: Math.max(1, completes, bombs) }, (_, index) => ({
      roundNumber: index + 1,
      endReason: index < completes ? 'cleared' : 'bombed',
      capturedCoins: index < completes ? 3 : 0,
      openedBagCount: 1,
    })),
  }
}
assert.equal(compareDuelParticipantResults(dSummary('A', 8, 0, 0), dSummary('B', 6, 3, 3)), 'A')
assert.equal(compareDuelParticipantResults(dSummary('A', 6, 2, 0), dSummary('B', 6, 1, 3)), 'A')
assert.equal(compareDuelParticipantResults(dSummary('A', 6, 1, 2), dSummary('B', 6, 1, 1)), 'A')
assert.equal(
  compareDuelParticipantResults(dSummary('A', 6, 1, 1, 9, 10), dSummary('B', 6, 1, 1, 1, 10)),
  'draw',
)
const duelSource = readFileSync(resolve(root, 'server/duel/duelResult.ts'), 'utf8')
const compareBlock = duelSource.slice(
  duelSource.indexOf('export function compareDuelParticipantResults'),
  duelSource.indexOf('export function compareDuelParticipantResults') + 700,
)
assert.match(compareBlock, /totalCapturedCoins/)
assert.match(compareBlock, /threeCoinsComplete/)
assert.match(compareBlock, /bombsHit/)
assert.doesNotMatch(compareBlock, /coinBagHits|totalOpens|hitRate|totalTime/)

/* --- GROUP SQL write path + schema + legacy read coerce --- */
const openSql = readFileSync(resolve(root, 'server/db/openGroupBag.ts'), 'utf8')
assert.match(openSql, /when judged\.bomb_hit then 0/)
assert.doesNotMatch(openSql, /when judged\.bomb_hit then judged\.prior_coins/)
const duelOpen = readFileSync(resolve(root, 'server/db/openDuelBag.ts'), 'utf8')
assert.match(duelOpen, /case when opened_view\.bomb_hit then 0 else 3 end/)
const schema = readFileSync(resolve(root, 'server/db/schema.ts'), 'utf8')
assert.match(
  schema,
  /\$\{table\.status\} = 'bombed'[\s\S]*?\$\{table\.capturedCoins\} = 0/,
)
assert.doesNotMatch(
  schema,
  /\$\{table\.status\} = 'bombed'[\s\S]*?\$\{table\.capturedCoins\} between 0 and 2/,
)
const groupResultDb = readFileSync(resolve(root, 'server/db/getGroupResult.ts'), 'utf8')
assert.match(
  groupResultDb,
  /endReason === 'bombed' \? 0 : storedCapturedCoins/,
)

const groupId = '123e4567-e89b-42d3-a456-426614174000'
const bombOk = {
  groupId,
  roundNumber: 1,
  bagNumber: 4,
  openOrder: 2,
  outcome: 'bomb' as const,
  coinsFound: 0 as const,
  provisionalCoins: 0 as const,
  openedBagCount: 2,
  roundEnded: true,
  endReason: 'bombed' as const,
  capturedCoins: 0 as const,
}
assert.deepEqual(
  parseGroupOpenResult(bombOk, { groupId, bagNumber: 4, requestId: groupId }),
  bombOk,
)
assert.throws(() =>
  parseGroupOpenResult(
    { ...bombOk, capturedCoins: 1 },
    { groupId, bagNumber: 4, requestId: groupId },
  ),
)

for (const [file, needles] of [
  [
    'src/components/GroupResultDetailScreen.tsx',
    [
      'className="duel-num"',
      'withDuelNums(formatGroupHitRate',
      'withDuelNums(formatGroupRoundEndReason',
    ],
  ],
  [
    'src/components/GroupResultScreen.tsx',
    ['className="duel-num"', 'withDuelNums('],
  ],
  ['src/components/DuelResultScreen.tsx', ['className="duel-num"']],
  ['src/components/DuelMatchDetailScreen.tsx', ['className="duel-num"']],
] as const) {
  const source = readFileSync(resolve(root, file), 'utf8')
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${file} missing ${needle}`)
  }
}

const markerCss = readFileSync(
  resolve(root, 'src/components/DuelMatchDetailBoard.css'),
  'utf8',
)
assert.match(
  markerCss,
  /\.duel-detail-open-marker\s*\{[\s\S]*?font-family:\s*system-ui/,
)
assert.doesNotMatch(
  markerCss,
  /\.duel-detail-open-marker\s*\{[\s\S]*?font-family:\s*Georgia/,
)

console.log('verify:bomb-confirmed-coins OK')
