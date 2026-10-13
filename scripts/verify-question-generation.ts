import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { BAG_COUNTS, type BagCount } from '../src/game/formations'
import { sequenceRandom, type RandomSource } from '../src/game/random'
import {
  drawQuestion,
  drawQuestionForBagCount,
  enumerateQuestionPlacements,
  generateUniqueQuestionSet,
  normalizeQuestionPlacement,
  pickWeightedQuestionBagCount,
  QUESTION_BAG_WEIGHTS,
  QUESTION_PLACEMENT_COUNTS,
  QUESTION_PLACEMENT_TOTAL,
  questionPlacementKey,
  recentSoloQuestionKeys,
} from '../src/game/questionGeneration'

function seededRandom(seedValue: number): RandomSource {
  let seed = seedValue >>> 0
  return {
    next() {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

function assertLegal(bagCount: BagCount): void {
  const placements = enumerateQuestionPlacements(bagCount)
  assert.equal(placements.length, QUESTION_PLACEMENT_COUNTS[bagCount])
  for (const placement of placements) {
    assert.equal(placement.bagCount, bagCount)
    assert(placement.bombBagNumber >= 1 && placement.bombBagNumber <= bagCount)
    assert.equal(placement.coinBagNumbers.length, 3)
    assert.deepEqual(
      placement.coinBagNumbers,
      [...placement.coinBagNumbers].sort((left, right) => left - right),
    )
    assert(placement.coinBagNumbers.every(
      (bagNumber) => bagNumber >= 1 &&
        bagNumber <= bagCount &&
        bagNumber !== placement.bombBagNumber,
    ))
  }
}

// Exact weighted boundaries: 0-5-15-30-55-80-100 percent.
const weightedBoundaries: readonly [number, BagCount][] = [
  [0, 3], [0.049999, 3], [0.05, 4], [0.149999, 4], [0.15, 5],
  [0.299999, 5], [0.3, 6], [0.549999, 6], [0.55, 7],
  [0.799999, 7], [0.8, 8], [0.999999, 8],
]
for (const [value, expected] of weightedBoundaries) {
  assert.equal(pickWeightedQuestionBagCount(sequenceRandom([value])), expected)
}
assert.throws(() => pickWeightedQuestionBagCount(sequenceRandom([1])))
assert.throws(() => pickWeightedQuestionBagCount(sequenceRandom([-0.01])))

const distributionIterations = 200_000
const distribution = new Map<BagCount, number>(BAG_COUNTS.map((bagCount) => [bagCount, 0]))
const distributionRandom = seededRandom(0x3cb2026)
for (let index = 0; index < distributionIterations; index += 1) {
  const bagCount = pickWeightedQuestionBagCount(distributionRandom)
  distribution.set(bagCount, distribution.get(bagCount)! + 1)
}
for (const bagCount of BAG_COUNTS) {
  const actual = distribution.get(bagCount)! / distributionIterations
  const expected = QUESTION_BAG_WEIGHTS[bagCount] / 100
  assert(Math.abs(actual - expected) < 0.005, `${bagCount}: ${actual} vs ${expected}`)
}

const allKeys = new Set<string>()
for (const bagCount of BAG_COUNTS) {
  assertLegal(bagCount)
  const placements = enumerateQuestionPlacements(bagCount)
  const keys = new Set(placements.map(questionPlacementKey))
  assert.equal(keys.size, QUESTION_PLACEMENT_COUNTS[bagCount])
  for (const key of keys) {
    assert(!allKeys.has(key))
    allKeys.add(key)
  }

  // Direct indexing proves each candidate occupies one equal-width RNG interval.
  const selected = new Set<string>()
  for (let index = 0; index < placements.length; index += 1) {
    selected.add(questionPlacementKey(drawQuestionForBagCount(
      bagCount,
      sequenceRandom([(index + 0.5) / placements.length]),
    )))
  }
  assert.equal(selected.size, placements.length)
}
assert.equal(allKeys.size, QUESTION_PLACEMENT_TOTAL)

const unordered = {
  bagCount: 5 as const,
  bombBagNumber: 2,
  coinBagNumbers: [5, 1, 5] as const,
}
assert.deepEqual(normalizeQuestionPlacement(unordered).coinBagNumbers, [1, 5, 5])
assert.equal(
  questionPlacementKey(unordered),
  questionPlacementKey({ ...unordered, coinBagNumbers: [5, 5, 1] }),
)
assert.throws(() => normalizeQuestionPlacement({
  bagCount: 3,
  bombBagNumber: 1,
  coinBagNumbers: [1, 2, 3],
}))

for (const rounds of [1, 5, 20]) {
  const questions = generateUniqueQuestionSet(rounds, seededRandom(rounds))
  assert.equal(questions.length, rounds)
  assert.equal(new Set(questions.map(questionPlacementKey)).size, rounds)
}

// The number of each bag size is sampled, not fixed.
const firstCounts = generateUniqueQuestionSet(20, seededRandom(1)).map((q) => q.bagCount)
const secondCounts = generateUniqueQuestionSet(20, seededRandom(2)).map((q) => q.bagCount)
assert.notDeepEqual(firstCounts, secondCounts)

// Always choose the first weighted count/candidate. After all twelve 3-bag
// placements are consumed, bagCount 3 is removed and selection continues at 4.
const zeros = sequenceRandom(Array.from({ length: 40 }, () => 0))
const exhausted = generateUniqueQuestionSet(20, zeros)
assert(exhausted.slice(0, 12).every((question) => question.bagCount === 3))
assert(exhausted.slice(12).every((question) => question.bagCount === 4))
assert.equal(new Set(exhausted.map(questionPlacementKey)).size, 20)

const historySource = generateUniqueQuestionSet(20, seededRandom(20))
const history = historySource.map(questionPlacementKey)
const historyDraw = drawQuestion(seededRandom(21), history)
assert(!history.includes(questionPlacementKey(historyDraw)))
assert.deepEqual(
  recentSoloQuestionKeys([...history, ...history.slice(0, 3)]),
  [...history.slice(3), ...history.slice(0, 3)],
)

const damagedHistory: unknown[] = [null, 12, {}, 'not-a-question-key', ...history.slice(0, 2)]
const damagedDraw = drawQuestion(seededRandom(22), damagedHistory)
assert(!history.slice(0, 2).includes(questionPlacementKey(damagedDraw)))
const throwingHistory = {
  [Symbol.iterator](): Iterator<unknown> {
    throw new Error('damaged history')
  },
}
assert.doesNotThrow(() => drawQuestion(seededRandom(23), throwingHistory))

// If every legal key is supplied, history is ignored rather than blocking play.
assert.doesNotThrow(() => drawQuestion(seededRandom(24), allKeys))

const reproducibleSequence = Array.from({ length: 40 }, (_, index) =>
  ((index * 37) % 101) / 101)
assert.deepEqual(
  generateUniqueQuestionSet(20, sequenceRandom(reproducibleSequence)),
  generateUniqueQuestionSet(20, sequenceRandom(reproducibleSequence)),
)

const performanceRuns = 1_000
const started = performance.now()
for (let index = 0; index < performanceRuns; index += 1) {
  const questions = generateUniqueQuestionSet(20, seededRandom(index + 1))
  assert.equal(questions.length, 20)
}
const elapsedMs = performance.now() - started

console.log('verify:question-generation OK')
console.log(`placements=${allKeys.size}`)
console.log(`distribution=${BAG_COUNTS.map((bagCount) => `${bagCount}:${distribution.get(bagCount)}`).join(' ')}`)
console.log(`performance=${performanceRuns} x 20 ROUND in ${elapsedMs.toFixed(1)}ms (${(elapsedMs / performanceRuns).toFixed(3)}ms/set)`)
