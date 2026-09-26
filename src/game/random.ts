/** Minimal injectable RNG boundary for game logic (not crypto). */

export type RandomSource = {
  /** Returns a float in the half-open range [0, 1). */
  next: () => number
}

export const defaultRandom: RandomSource = {
  next: () => Math.random(),
}

/** Deterministic source for tests — consumes values in order. */
export function sequenceRandom(values: readonly number[]): RandomSource {
  let i = 0
  return {
    next() {
      if (i >= values.length) {
        throw new Error(`sequenceRandom exhausted at index ${i}`)
      }
      const v = values[i]!
      i += 1
      if (!(v >= 0 && v < 1)) {
        throw new Error(`sequenceRandom value must be in [0, 1), got ${v}`)
      }
      return v
    },
  }
}

/** Uniform int in [0, maxExclusive). */
export function randomInt(random: RandomSource, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt: maxExclusive must be a positive integer, got ${maxExclusive}`)
  }
  return Math.floor(random.next() * maxExclusive)
}

export function pickOne<T>(random: RandomSource, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickOne: empty list')
  }
  return items[randomInt(random, items.length)]!
}

/**
 * Pick `count` distinct items uniformly without replacement.
 * Order of the returned array is random (Fisher–Yates sample).
 */
export function pickDistinct<T>(
  random: RandomSource,
  items: readonly T[],
  count: number,
): T[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`pickDistinct: count must be a non-negative integer, got ${count}`)
  }
  if (count > items.length) {
    throw new Error(`pickDistinct: cannot pick ${count} from ${items.length}`)
  }
  const pool = items.slice()
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(random, pool.length - i)
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, count)
}

/** In-place Fisher–Yates shuffle; returns the same array. */
export function shuffleInPlace<T>(random: RandomSource, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1)
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}
