import { type BagId } from './assets'
import {
  BAG_COUNTS,
  bagsForCount,
  isBagCount,
  type BagCount,
} from './formations'
import { defaultRandom, pickOne, type RandomSource } from './random'

/** One bag's hidden contents. Bomb never coexists with coins. */
export type BagContents =
  | { readonly kind: 'empty' }
  | { readonly kind: 'coins'; readonly coinCount: 1 | 2 | 3 }
  | { readonly kind: 'bomb' }

export const EMPTY_CONTENTS: BagContents = { kind: 'empty' }
export const BOMB_CONTENTS: BagContents = { kind: 'bomb' }

export function coinsContents(coinCount: 1 | 2 | 3): BagContents {
  return { kind: 'coins', coinCount }
}

/**
 * Observed split of the 3 coins across bags (derived after placement).
 * Never used as a generation input / lottery.
 */
export type CoinPartition =
  | readonly [3]
  | readonly [2, 1]
  | readonly [1, 1, 1]

export const COIN_PARTITION_3: CoinPartition = [3]
export const COIN_PARTITION_2_1: CoinPartition = [2, 1]
export const COIN_PARTITION_1_1_1: CoinPartition = [1, 1, 1]

export type HiddenHandBag = {
  readonly bagId: BagId
  readonly contents: BagContents
}

/**
 * One ROUND's hidden hand. Not for player UI.
 * `bags` order matches formation bag-1 … bag-N.
 */
export type HiddenHand = {
  readonly bagCount: BagCount
  readonly bags: readonly HiddenHandBag[]
  readonly coinTotal: 3
  readonly bombBagId: BagId
  /** Derived from coin placement; not chosen up front. */
  readonly coinPartition: CoinPartition
}

/** Partitions that can arise for a given bagCount under natural coin placement. */
export function possibleCoinPartitions(bagCount: BagCount): readonly CoinPartition[] {
  // Only 2 non-bomb bags → three distinct coin bags impossible.
  if (bagCount === 3) {
    return [COIN_PARTITION_3, COIN_PARTITION_2_1]
  }
  return [COIN_PARTITION_3, COIN_PARTITION_2_1, COIN_PARTITION_1_1_1]
}

/** @deprecated Use possibleCoinPartitions — kept as alias for clarity in callers. */
export const legalCoinPartitions = possibleCoinPartitions

export function isPossibleCoinPartition(
  bagCount: BagCount,
  partition: CoinPartition,
): boolean {
  return possibleCoinPartitions(bagCount).some((p) => samePartition(p, partition))
}

function samePartition(a: CoinPartition, b: CoinPartition): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort((x, y) => y - x)
  const bs = [...b].sort((x, y) => y - x)
  return as.every((v, i) => v === bs[i])
}

export function deriveCoinPartition(
  coinCounts: readonly number[],
): CoinPartition {
  const sorted = [...coinCounts].filter((n) => n > 0).sort((a, b) => b - a)
  if (sorted.length === 1 && sorted[0] === 3) return COIN_PARTITION_3
  if (sorted.length === 2 && sorted[0] === 2 && sorted[1] === 1) {
    return COIN_PARTITION_2_1
  }
  if (sorted.length === 3 && sorted[0] === 1 && sorted[1] === 1 && sorted[2] === 1) {
    return COIN_PARTITION_1_1_1
  }
  throw new Error(`deriveCoinPartition: cannot derive from [${sorted.join(',')}]`)
}

export function pickRandomBagCount(
  random: RandomSource = defaultRandom,
): BagCount {
  return pickOne(random, BAG_COUNTS)
}

export type CreateHiddenHandInput = {
  bagCount: BagCount
  bombBagId: BagId
  /**
   * Exactly three bag ids — one random (or explicit) pick per coin.
   * The same bag may appear more than once.
   */
  coinTargets: readonly [BagId, BagId, BagId]
}

/**
 * Build a hand from explicit bomb + per-coin targets (no RNG).
 * Throws on illegal input — never silently corrects.
 * `coinPartition` is derived from the targets.
 */
export function createHiddenHand(input: CreateHiddenHandInput): HiddenHand {
  const { bagCount, bombBagId, coinTargets } = input

  if (!isBagCount(bagCount)) {
    throw new Error(`createHiddenHand: invalid bagCount ${String(bagCount)}`)
  }
  if (coinTargets.length !== 3) {
    throw new Error(
      `createHiddenHand: expected exactly 3 coinTargets, got ${coinTargets.length}`,
    )
  }

  const expectedIds = bagsForCount(bagCount)
  const idSet = new Set<string>(expectedIds)

  if (!idSet.has(bombBagId)) {
    throw new Error(`createHiddenHand: bombBagId ${bombBagId} not in ${bagCount}-bag set`)
  }

  const coinByBag = new Map<BagId, number>()

  for (const bagId of coinTargets) {
    if (!idSet.has(bagId)) {
      throw new Error(`createHiddenHand: coin target ${bagId} not in ${bagCount}-bag set`)
    }
    if (bagId === bombBagId) {
      throw new Error('createHiddenHand: bomb and coins cannot share a bag')
    }
    coinByBag.set(bagId, (coinByBag.get(bagId) ?? 0) + 1)
  }

  for (const [bagId, count] of coinByBag) {
    if (count < 1 || count > 3) {
      throw new Error(`createHiddenHand: invalid aggregated coinCount ${count} on ${bagId}`)
    }
  }

  const partition = deriveCoinPartition([...coinByBag.values()])
  if (!isPossibleCoinPartition(bagCount, partition)) {
    throw new Error(
      `createHiddenHand: derived partition ${partition.join('+')} impossible for ${bagCount} bags`,
    )
  }

  const bags: HiddenHandBag[] = expectedIds.map((bagId) => {
    if (bagId === bombBagId) {
      return { bagId, contents: BOMB_CONTENTS }
    }
    const coinCount = coinByBag.get(bagId)
    if (coinCount !== undefined) {
      return { bagId, contents: coinsContents(coinCount as 1 | 2 | 3) }
    }
    return { bagId, contents: EMPTY_CONTENTS }
  })

  const hand: HiddenHand = {
    bagCount,
    bags,
    coinTotal: 3,
    bombBagId,
    coinPartition: partition,
  }

  assertHiddenHandInvariants(hand)
  return hand
}

/**
 * Generate a legal ROUND hand for an explicit bag count.
 * Coins are placed one-by-one into non-bomb bags (with replacement).
 * Partition is an outcome, never pre-drawn.
 */
export function generateHiddenHand(
  bagCount: number,
  random: RandomSource = defaultRandom,
): HiddenHand {
  if (!isBagCount(bagCount)) {
    throw new Error(`generateHiddenHand: invalid bagCount ${bagCount}`)
  }

  const bags = bagsForCount(bagCount)
  const bombBagId = pickOne(random, bags)
  const coinCandidates = bags.filter((id) => id !== bombBagId)

  const coinTargets: [BagId, BagId, BagId] = [
    pickOne(random, coinCandidates),
    pickOne(random, coinCandidates),
    pickOne(random, coinCandidates),
  ]

  return createHiddenHand({ bagCount, bombBagId, coinTargets })
}

/**
 * Solo system-generated ROUND: bag count is uniform in 3–8, then a hand is generated.
 * Pair / multiplayer can call `generateHiddenHand(bagCount)` with an external count instead.
 */
export function generateSoloSystemHand(
  random: RandomSource = defaultRandom,
): HiddenHand {
  const bagCount = pickRandomBagCount(random)
  return generateHiddenHand(bagCount, random)
}

export function assertHiddenHandInvariants(hand: HiddenHand): void {
  const { bagCount, bags, bombBagId, coinPartition } = hand

  if (!isBagCount(bagCount)) {
    throw new Error(`invariant: invalid bagCount ${String(bagCount)}`)
  }
  if (bags.length !== bagCount) {
    throw new Error(`invariant: bags.length ${bags.length} !== bagCount ${bagCount}`)
  }

  const expectedIds = bagsForCount(bagCount)
  for (let i = 0; i < bagCount; i++) {
    if (bags[i]!.bagId !== expectedIds[i]) {
      throw new Error(
        `invariant: bags[${i}] is ${bags[i]!.bagId}, expected ${expectedIds[i]}`,
      )
    }
  }

  const seen = new Set<string>()
  let coinTotal = 0
  let bombCount = 0
  let emptyCount = 0
  let foundBombId: BagId | null = null
  const coinCounts: number[] = []

  for (const { bagId, contents } of bags) {
    if (seen.has(bagId)) {
      throw new Error(`invariant: duplicate bagId ${bagId}`)
    }
    seen.add(bagId)

    if (contents.kind === 'bomb') {
      bombCount += 1
      foundBombId = bagId
    } else if (contents.kind === 'coins') {
      if (contents.coinCount < 1 || contents.coinCount > 3) {
        throw new Error(`invariant: bad coinCount on ${bagId}`)
      }
      coinTotal += contents.coinCount
      coinCounts.push(contents.coinCount)
    } else if (contents.kind === 'empty') {
      emptyCount += 1
    } else {
      const _exhaustive: never = contents
      throw new Error(`invariant: unknown contents ${JSON.stringify(_exhaustive)}`)
    }
  }

  if (coinTotal !== 3) {
    throw new Error(`invariant: coinTotal ${coinTotal} !== 3`)
  }
  if (hand.coinTotal !== 3) {
    throw new Error('invariant: hand.coinTotal must be 3')
  }
  if (bombCount !== 1 || foundBombId === null) {
    throw new Error(`invariant: bombCount ${bombCount} !== 1`)
  }
  if (foundBombId !== bombBagId) {
    throw new Error(
      `invariant: bombBagId field ${bombBagId} !== contents bomb ${foundBombId}`,
    )
  }

  const derived = deriveCoinPartition(coinCounts)
  if (!samePartition(derived, coinPartition)) {
    throw new Error(
      `invariant: coinPartition ${coinPartition.join('+')} !== derived ${derived.join('+')}`,
    )
  }
  if (!isPossibleCoinPartition(bagCount, coinPartition)) {
    throw new Error(
      `invariant: impossible partition ${coinPartition.join('+')} for ${bagCount} bags`,
    )
  }

  const coinBagCount = bags.filter((b) => b.contents.kind === 'coins').length
  if (coinBagCount !== coinPartition.length) {
    throw new Error(
      `invariant: coin bag count ${coinBagCount} !== partition length ${coinPartition.length}`,
    )
  }

  const expectedEmpty = bagCount - 1 - coinPartition.length
  if (emptyCount !== expectedEmpty) {
    throw new Error(
      `invariant: emptyCount ${emptyCount} !== expected ${expectedEmpty}`,
    )
  }
}

export function getBagContents(hand: HiddenHand, bagId: BagId): BagContents {
  const entry = hand.bags.find((b) => b.bagId === bagId)
  if (!entry) {
    throw new Error(`getBagContents: ${bagId} not in hand`)
  }
  return entry.contents
}

/**
 * Theoretical partition rates when 3 coins are placed independently
 * into (bagCount - 1) non-bomb bags (verify guide only).
 */
export function theoreticalPartitionRates(bagCount: BagCount): {
  '3': number
  '2+1': number
  '1+1+1': number
} {
  const m = bagCount - 1
  return {
    '3': 1 / (m * m),
    '2+1': (3 * (m - 1)) / (m * m),
    '1+1+1': m >= 3 ? ((m - 1) * (m - 2)) / (m * m) : 0,
  }
}
