import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { questionPlacementKey } from '../src/game/questionGeneration'
import { validateGroupPlacementSet } from '../src/group/groupDomain'
import {
  createGeneratedGroupPlacementProvider,
  type GroupRandomSource,
} from '../server/group/groupPlacementProvider'

function seededRandom(seedValue: number): GroupRandomSource {
  let seed = seedValue >>> 0
  return {
    next() {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

function keysFor(seed: number, rounds: number): readonly string[] {
  const candidates = createGeneratedGroupPlacementProvider(
    seededRandom(seed),
  ).provide(rounds)
  const validated = validateGroupPlacementSet({
    totalRounds: rounds,
    placements: candidates,
  })
  assert.equal(validated.placements.length, rounds)
  return validated.placements.map(({ origin, placement }, index) => {
    assert.equal(origin, 'generated')
    assert.equal(placement.roundNumber, index + 1)
    return questionPlacementKey(placement)
  })
}

for (const rounds of [1, 5, 7, 20]) {
  const keys = keysFor(rounds, rounds)
  assert.equal(keys.length, rounds)
  assert.equal(new Set(keys).size, rounds)
}

const first = keysFor(101, 20)
const same = keysFor(101, 20)
const otherGroup = keysFor(102, 20)
assert.deepEqual(first, same, 'same random sequence must reproduce the set')
assert.notDeepEqual(first, otherGroup, 'bag counts and placements are not fixed')

// Separate GROUPs may reuse placements; identical random input demonstrates
// that no cross-GROUP history is applied.
assert.deepEqual(keysFor(500, 5), keysFor(500, 5))

// Consume all twelve 3-bag candidates, then verify the exhausted bag count is
// removed and the remaining weights are renormalized without duplicates.
const zeroRandom: GroupRandomSource = { next: () => 0 }
const exhausted = createGeneratedGroupPlacementProvider(zeroRandom).provide(20)
assert(exhausted.slice(0, 12).every(({ placement }) => placement.bagCount === 3))
assert(exhausted.slice(12).every(({ placement }) => placement.bagCount === 4))
assert.equal(
  new Set(exhausted.map(({ placement }) => questionPlacementKey(placement))).size,
  20,
)

// Across many independent GROUPs, verify the configured per-ROUND weighting.
const counts = new Map<number, number>([3, 4, 5, 6, 7, 8].map((count) => [count, 0]))
const distributionGroups = 10_000
const distributionRandom = seededRandom(0x3cb2026)
for (let index = 0; index < distributionGroups; index += 1) {
  const candidate = createGeneratedGroupPlacementProvider(distributionRandom).provide(1)[0]!
  const bagCount = candidate.placement.bagCount
  counts.set(bagCount, counts.get(bagCount)! + 1)
}
const weights = new Map<number, number>([[3, 5], [4, 10], [5, 15], [6, 25], [7, 25], [8, 20]])
for (const [bagCount, expectedPercent] of weights) {
  const actualPercent = counts.get(bagCount)! / distributionGroups * 100
  assert(
    Math.abs(actualPercent - expectedPercent) < 1.5,
    `${bagCount}: ${actualPercent}% vs ${expectedPercent}%`,
  )
}

const providerSource = readFileSync(
  resolve(process.cwd(), 'server/group/groupPlacementProvider.ts'),
  'utf8',
)
assert(providerSource.includes('generateUniqueQuestionSet('))
assert(providerSource.includes('createServerCryptoRandomSource()'))
assert(!providerSource.includes('Math.random'))

for (const path of [
  'server/db/groupPlay.ts',
  'server/db/openGroupBag.ts',
  'server/db/cashOutGroupRound.ts',
  'src/group/groupPlayClient.ts',
]) {
  const source = readFileSync(resolve(process.cwd(), path), 'utf8')
  assert(!source.includes('generateUniqueQuestionSet('), `${path} generates questions`)
}

const performanceRuns = 1_000
const started = performance.now()
for (let index = 0; index < performanceRuns; index += 1) {
  createGeneratedGroupPlacementProvider(seededRandom(index + 1)).provide(20)
}
const elapsedMs = performance.now() - started

console.log('verify:group-question-generation OK')
console.log(`distribution=${[...counts].map(([count, hits]) => `${count}:${hits}`).join(' ')}`)
console.log(`performance=${performanceRuns} x 20 ROUND in ${elapsedMs.toFixed(1)}ms (${(elapsedMs / performanceRuns).toFixed(3)}ms/GROUP)`)
