import { BAG_COUNTS, isBagCount, type BagCount } from './formations'
import { defaultRandom, type RandomSource } from './random'

export type QuestionPlacement = {
  readonly bagCount: BagCount
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export const QUESTION_BAG_WEIGHTS = {
  3: 5,
  4: 10,
  5: 15,
  6: 25,
  7: 25,
  8: 20,
} as const satisfies Record<BagCount, number>

export const QUESTION_PLACEMENT_COUNTS = {
  3: 12,
  4: 40,
  5: 100,
  6: 210,
  7: 392,
  8: 672,
} as const satisfies Record<BagCount, number>

export const QUESTION_PLACEMENT_TOTAL = 1_426
export const QUESTION_SET_MAX_ROUNDS = 20
export const SOLO_QUESTION_HISTORY_LIMIT = 20

const placementCache = new Map<BagCount, readonly QuestionPlacement[]>()
const placementKeyCache = new Map<BagCount, ReadonlySet<string>>()

function sample(random: RandomSource): number {
  const value = random.next()
  if (!(value >= 0 && value < 1)) {
    throw new Error('Question random source returned an invalid sample.')
  }
  return value
}

function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}.`)
  }
  return value
}

export function normalizeQuestionPlacement(
  placement: QuestionPlacement,
): QuestionPlacement {
  const bagCountValue: number = placement.bagCount
  if (!isBagCount(bagCountValue)) throw new Error('Invalid bagCount.')
  const bagCount = bagCountValue
  const bombBagNumber = integer(
    placement.bombBagNumber,
    1,
    bagCount,
    'bombBagNumber',
  )
  if (!Array.isArray(placement.coinBagNumbers) || placement.coinBagNumbers.length !== 3) {
    throw new Error('Invalid coinBagNumbers.')
  }
  const coinBagNumbers = placement.coinBagNumbers
    .map((bagNumber) => integer(bagNumber, 1, bagCount, 'coinBagNumber'))
    .sort((left, right) => left - right) as [number, number, number]
  if (coinBagNumbers.includes(bombBagNumber)) {
    throw new Error('BOMB and COIN cannot share a bag.')
  }
  return { bagCount, bombBagNumber, coinBagNumbers }
}

export function questionPlacementKey(placement: QuestionPlacement): string {
  const normalized = normalizeQuestionPlacement(placement)
  return `${normalized.bagCount}|${normalized.bombBagNumber}|${normalized.coinBagNumbers.join(',')}`
}

function buildPlacements(bagCount: BagCount): readonly QuestionPlacement[] {
  const placements: QuestionPlacement[] = []
  for (let bombBagNumber = 1; bombBagNumber <= bagCount; bombBagNumber += 1) {
    const coinCandidates = Array.from(
      { length: bagCount },
      (_, index) => index + 1,
    ).filter((bagNumber) => bagNumber !== bombBagNumber)
    for (let first = 0; first < coinCandidates.length; first += 1) {
      for (let second = first; second < coinCandidates.length; second += 1) {
        for (let third = second; third < coinCandidates.length; third += 1) {
          placements.push({
            bagCount,
            bombBagNumber,
            coinBagNumbers: [
              coinCandidates[first]!,
              coinCandidates[second]!,
              coinCandidates[third]!,
            ],
          })
        }
      }
    }
  }
  if (placements.length !== QUESTION_PLACEMENT_COUNTS[bagCount]) {
    throw new Error('Question placement enumeration is inconsistent.')
  }
  return placements
}

export function enumerateQuestionPlacements(
  bagCount: BagCount,
): readonly QuestionPlacement[] {
  const cached = placementCache.get(bagCount)
  if (cached) return cached
  const placements = buildPlacements(bagCount)
  placementCache.set(bagCount, placements)
  placementKeyCache.set(
    bagCount,
    new Set(placements.map((placement) => questionPlacementKey(placement))),
  )
  return placements
}

function knownPlacementKeys(bagCount: BagCount): ReadonlySet<string> {
  enumerateQuestionPlacements(bagCount)
  return placementKeyCache.get(bagCount)!
}

function sanitizeExcludedKeys(values: Iterable<unknown> | null | undefined): Set<string> {
  const result = new Set<string>()
  if (values == null) return result
  try {
    for (const value of values) {
      if (typeof value !== 'string') continue
      for (const bagCount of BAG_COUNTS) {
        if (knownPlacementKeys(bagCount).has(value)) {
          result.add(value)
          break
        }
      }
    }
  } catch {
    return new Set<string>()
  }
  return result
}

function pickIndex(random: RandomSource, length: number): number {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error('Cannot choose from an empty question pool.')
  }
  return Math.floor(sample(random) * length)
}

export function pickWeightedQuestionBagCount(
  random: RandomSource = defaultRandom,
  availableBagCounts: readonly BagCount[] = BAG_COUNTS,
): BagCount {
  const available = BAG_COUNTS.filter((bagCount) => availableBagCounts.includes(bagCount))
  if (available.length === 0) throw new Error('No question bag count is available.')
  const totalWeight = available.reduce(
    (total, bagCount) => total + QUESTION_BAG_WEIGHTS[bagCount],
    0,
  )
  let target = sample(random) * totalWeight
  for (const bagCount of available) {
    const weight = QUESTION_BAG_WEIGHTS[bagCount]
    if (target < weight) return bagCount
    target -= weight
  }
  return available[available.length - 1]!
}

export function drawQuestionForBagCount(
  bagCount: BagCount,
  random: RandomSource = defaultRandom,
  excludedKeys?: Iterable<unknown> | null,
): QuestionPlacement {
  const excluded = sanitizeExcludedKeys(excludedKeys)
  const all = enumerateQuestionPlacements(bagCount)
  const available = excluded.size === 0
    ? all
    : all.filter((placement) => !excluded.has(questionPlacementKey(placement)))
  const pool = available.length > 0 ? available : all
  return pool[pickIndex(random, pool.length)]!
}

export function drawQuestion(
  random: RandomSource = defaultRandom,
  excludedKeys?: Iterable<unknown> | null,
): QuestionPlacement {
  const excluded = sanitizeExcludedKeys(excludedKeys)
  const availableByBagCount = new Map<BagCount, readonly QuestionPlacement[]>()
  for (const bagCount of BAG_COUNTS) {
    const available = enumerateQuestionPlacements(bagCount).filter(
      (placement) => !excluded.has(questionPlacementKey(placement)),
    )
    if (available.length > 0) availableByBagCount.set(bagCount, available)
  }
  if (availableByBagCount.size === 0) {
    const bagCount = pickWeightedQuestionBagCount(random)
    return drawQuestionForBagCount(bagCount, random)
  }
  const bagCount = pickWeightedQuestionBagCount(
    random,
    [...availableByBagCount.keys()],
  )
  const pool = availableByBagCount.get(bagCount)!
  return pool[pickIndex(random, pool.length)]!
}

export function generateUniqueQuestionSet(
  roundCount: number,
  random: RandomSource = defaultRandom,
): readonly QuestionPlacement[] {
  integer(roundCount, 1, QUESTION_SET_MAX_ROUNDS, 'roundCount')
  const pools = new Map<BagCount, QuestionPlacement[]>()
  for (const bagCount of BAG_COUNTS) {
    pools.set(bagCount, [...enumerateQuestionPlacements(bagCount)])
  }
  const result: QuestionPlacement[] = []
  for (let round = 0; round < roundCount; round += 1) {
    const availableBagCounts = BAG_COUNTS.filter(
      (bagCount) => (pools.get(bagCount)?.length ?? 0) > 0,
    )
    const bagCount = pickWeightedQuestionBagCount(random, availableBagCounts)
    const pool = pools.get(bagCount)!
    const index = pickIndex(random, pool.length)
    const placement = pool[index]!
    const last = pool.pop()!
    if (index < pool.length) pool[index] = last
    result.push(placement)
  }
  return result
}

export function recentSoloQuestionKeys(
  values: Iterable<unknown> | null | undefined,
): readonly string[] {
  if (values == null) return []
  const valid: string[] = []
  try {
    for (const value of values) {
      if (
        typeof value === 'string' &&
        BAG_COUNTS.some((bagCount) => knownPlacementKeys(bagCount).has(value))
      ) {
        valid.push(value)
      }
    }
  } catch {
    return []
  }
  return valid.slice(-SOLO_QUESTION_HISTORY_LIMIT)
}
