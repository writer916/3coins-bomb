/**
 * Lightweight verify for natural hidden-hand generation (no test framework).
 * Run: npm run verify:hand
 */
import {
  assertHiddenHandInvariants,
  createHiddenHand,
  generateHiddenHand,
  generateSoloSystemHand,
  possibleCoinPartitions,
  theoreticalPartitionRates,
  type CoinPartition,
  type HiddenHand,
} from '../src/game/hand'
import { BAG_COUNTS, bagsForCount } from '../src/game/formations'
import { sequenceRandom } from '../src/game/random'

const ITERATIONS_PER_COUNT = 40_000
const SOLO_ITERATIONS = 24_000
/** Absolute percentage-point tolerance vs theoretical rates. */
const RATE_TOLERANCE_PP = 2.5

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function partitionKey(p: CoinPartition): string {
  return [...p].sort((a, b) => b - a).join('+')
}

function observePartition(hand: HiddenHand): string {
  return partitionKey(hand.coinPartition)
}

const measuredRates: Record<string, Record<string, string>> = {}

// --- 1) Mass generation per explicit bagCount ---
for (const bagCount of BAG_COUNTS) {
  const counts: Record<string, number> = { '3': 0, '2+1': 0, '1+1+1': 0 }
  const seen = new Set<string>()

  for (let i = 0; i < ITERATIONS_PER_COUNT; i++) {
    let hand: HiddenHand
    try {
      hand = generateHiddenHand(bagCount)
      assertHiddenHandInvariants(hand)
    } catch (e) {
      fail(`bagCount=${bagCount} iter=${i}: ${e instanceof Error ? e.message : e}`)
      continue
    }

    if (hand.bagCount !== bagCount) {
      fail(`bagCount=${bagCount}: hand.bagCount mismatch`)
    }

    const key = observePartition(hand)
    seen.add(key)
    if (key in counts) counts[key]! += 1
    else fail(`bagCount=${bagCount}: unexpected partition ${key}`)
  }

  if (bagCount === 3 && counts['1+1+1']! > 0) {
    fail('bagCount=3: observed illegal 1+1+1')
  }

  for (const p of possibleCoinPartitions(bagCount)) {
    const key = partitionKey(p)
    if (!seen.has(key)) {
      fail(`bagCount=${bagCount}: never saw partition ${key}`)
    }
  }

  const theory = theoreticalPartitionRates(bagCount)
  const rates: Record<string, string> = {}
  for (const key of ['3', '2+1', '1+1+1'] as const) {
    const actual = (counts[key]! / ITERATIONS_PER_COUNT) * 100
    const expected = theory[key] * 100
    rates[key] = `${actual.toFixed(2)}% (theory ${expected.toFixed(2)}%)`
    if (Math.abs(actual - expected) > RATE_TOLERANCE_PP) {
      fail(
        `bagCount=${bagCount} partition ${key}: actual ${actual.toFixed(2)}% vs theory ${expected.toFixed(2)}% (tol ±${RATE_TOLERANCE_PP}pp)`,
      )
    }
  }
  measuredRates[String(bagCount)] = rates

  ok(
    `bagCount=${bagCount}: ${ITERATIONS_PER_COUNT} gens; rates 3=${rates['3']}, 2+1=${rates['2+1']}, 1+1+1=${rates['1+1+1']}`,
  )
}

// --- 2) Solo system hand: bagCount uniform in 3–8 ---
{
  const bagHits: Record<number, number> = { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 }
  for (let i = 0; i < SOLO_ITERATIONS; i++) {
    const hand = generateSoloSystemHand()
    assertHiddenHandInvariants(hand)
    if (!BAG_COUNTS.includes(hand.bagCount)) {
      fail(`solo: illegal bagCount ${hand.bagCount}`)
    } else {
      bagHits[hand.bagCount]! += 1
    }
  }
  const expectedShare = SOLO_ITERATIONS / BAG_COUNTS.length
  for (const n of BAG_COUNTS) {
    const hit = bagHits[n]!
    if (hit === 0) fail(`solo: bagCount ${n} never appeared`)
    const pp = (Math.abs(hit - expectedShare) / SOLO_ITERATIONS) * 100
    if (pp > 2.0) {
      fail(`solo: bagCount ${n} share off by ${pp.toFixed(2)}pp (hits=${hit})`)
    }
  }
  ok(
    `solo bagCount spread: ${BAG_COUNTS.map((n) => `${n}=${bagHits[n]}`).join(', ')}`,
  )
}

// --- 3) Invalid explicit bagCount ---
for (const bad of [2, 9, 0, -1, 3.5, NaN]) {
  try {
    generateHiddenHand(bad as number)
    fail(`expected throw for bagCount=${bad}`)
  } catch {
    ok(`rejects bagCount=${bad}`)
  }
}

// --- 4) Explicit createHiddenHand ---
{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-2'],
  })
  assertHiddenHandInvariants(hand)
  if (observePartition(hand) !== '3') fail('explicit 3 mismatch')
  else ok('createHiddenHand 3-in-one-bag')

  const hand21 = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-5', 'bag-2'],
  })
  if (observePartition(hand21) !== '2+1') fail('explicit 2+1 mismatch')
  else ok('createHiddenHand 2+1')

  const hand111 = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  if (observePartition(hand111) !== '1+1+1') fail('explicit 1+1+1 mismatch')
  else ok('createHiddenHand 1+1+1')
}

// --- 5) 3-bag cannot place 1+1+1 (only 2 coin candidates) ---
try {
  createHiddenHand({
    bagCount: 3,
    bombBagId: 'bag-1',
    coinTargets: ['bag-1', 'bag-2', 'bag-3'],
  })
  fail('should reject coin on bomb bag')
} catch {
  ok('rejects coin target on bomb bag')
}

// --- 6) Controlled RNG: bagCount, bomb, three coins ---
// generateSoloSystemHand / generateHiddenHand consume:
// solo: pick bagCount among 6, then bomb among N, then 3× coin among N-1
{
  // Force bagCount=5 → index 2 among [3,4,5,6,7,8] → use 2.1/6
  // bomb = bag-1 → 0
  // coins all on first candidate (bag-2) → 0,0,0 → partition 3
  const hand3 = generateSoloSystemHand(
    sequenceRandom([2.1 / 6, 0.0, 0.0, 0.0, 0.0]),
  )
  assertHiddenHandInvariants(hand3)
  if (hand3.bagCount !== 5) fail(`controlled solo bagCount got ${hand3.bagCount}`)
  else if (hand3.bombBagId !== 'bag-1') fail(`controlled bomb got ${hand3.bombBagId}`)
  else if (observePartition(hand3) !== '3') fail(`controlled partition got ${observePartition(hand3)}`)
  else ok('controlled RNG: bagCount=5, bomb=bag-1, partition=3')

  // bagCount=5 fixed: bomb bag-1 (0), coins indices 0,1,2 → bag-2,3,4 → 1+1+1
  const hand111 = generateHiddenHand(
    5,
    sequenceRandom([0.0, 0.0, 0.25, 0.5]),
  )
  // coinCandidates length 4: 0→bag-2, 0.25→idx1 bag-3, 0.5→idx2 bag-4
  assertHiddenHandInvariants(hand111)
  if (observePartition(hand111) !== '1+1+1') {
    fail(`controlled 1+1+1 got ${observePartition(hand111)} bomb=${hand111.bombBagId}`)
  } else ok('controlled RNG: fixed bagCount=5 → 1+1+1')

  // 2+1: bomb bag-1, coins bag-2, bag-2, bag-3 → 0, 0, 0.25
  const hand21 = generateHiddenHand(5, sequenceRandom([0.0, 0.0, 0.0, 0.25]))
  if (observePartition(hand21) !== '2+1') {
    fail(`controlled 2+1 got ${observePartition(hand21)}`)
  } else ok('controlled RNG: fixed bagCount=5 → 2+1')
}

// --- 7) Formation bag ids only (no coordinate coupling in API) ---
for (const bagCount of BAG_COUNTS) {
  const hand = generateHiddenHand(bagCount)
  const ids = hand.bags.map((b) => b.bagId)
  const expected = [...bagsForCount(bagCount)]
  if (ids.join() !== expected.join()) {
    fail(`bag ids mismatch for ${bagCount}`)
  }
}
ok('bag ids always match bagsForCount / formation ids')

console.log('\nMeasured partition rates:')
for (const [n, rates] of Object.entries(measuredRates)) {
  console.log(`  ${n}: 3=${rates['3']}; 2+1=${rates['2+1']}; 1+1+1=${rates['1+1+1']}`)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log(
  `\nAll hidden-hand checks passed (${ITERATIONS_PER_COUNT}×${BAG_COUNTS.length} + ${SOLO_ITERATIONS} solo).`,
)
