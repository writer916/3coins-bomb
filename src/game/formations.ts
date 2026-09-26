import { BAG_IDS, type BagId } from './assets'

export const BAG_COUNTS = [3, 4, 5, 6, 7, 8] as const
export type BagCount = (typeof BAG_COUNTS)[number]

/**
 * Fixed board slot for a bag.
 * x/y are percentages of the board box (0–100), targeting the bag center.
 * Coordinates stay fixed even when a bag is later opened (empty space remains).
 *
 * Light partial overlaps (edges / drawstrings / front over back hem) are intentional.
 * Avoid burying a bag’s center or making tap targets ambiguous.
 */
export type FormationSlot = {
  bagId: BagId
  x: number
  y: number
}

/**
 * Deterministic formations for bag counts 3–8.
 * Slot order and bagId mapping are stable (bag-1 … bag-N); never randomized.
 *
 * Hand-placed cluster: tight spacing, slight Y drift within a row.
 * No image rotation — naturalness comes from position (+ light overlap).
 *
 * Layout meaning:
 * - Smaller y = back row (奥 / top of screen on phone)
 * - Larger y = front row (手前 / lower on screen)
 * - Count 8: back 4 + front 3 + bag-8 at front height, slightly right
 */
export const FORMATIONS: Record<BagCount, readonly FormationSlot[]> = {
  3: [
    { bagId: 'bag-1', x: 24, y: 48.5 },
    { bagId: 'bag-2', x: 50, y: 53.5 },
    { bagId: 'bag-3', x: 76, y: 50 },
  ],
  4: [
    // One horizontal cluster; edges lightly overlap
    { bagId: 'bag-1', x: 25, y: 49.5 },
    { bagId: 'bag-2', x: 42, y: 53 },
    { bagId: 'bag-3', x: 57, y: 48 },
    { bagId: 'bag-4', x: 75, y: 51.5 },
  ],
  5: [
    // back (奥) 3
    { bagId: 'bag-1', x: 29, y: 38 },
    { bagId: 'bag-2', x: 50, y: 34 },
    { bagId: 'bag-3', x: 71, y: 39 },
    // front (手前) 2 — tops nest into back hems
    { bagId: 'bag-4', x: 39, y: 51 },
    { bagId: 'bag-5', x: 61, y: 54.5 },
  ],
  6: [
    // back 4
    { bagId: 'bag-1', x: 23, y: 40 },
    { bagId: 'bag-2', x: 40, y: 36 },
    { bagId: 'bag-3', x: 56, y: 39.5 },
    { bagId: 'bag-4', x: 73, y: 37 },
    // front 2 — nest into back hems
    { bagId: 'bag-5', x: 41, y: 51 },
    { bagId: 'bag-6', x: 58, y: 54.5 },
  ],
  7: [
    // Dedicated 7-bag coords (not a copy of the 6-bag row)
    { bagId: 'bag-1', x: 24, y: 38 },
    { bagId: 'bag-2', x: 41, y: 34 },
    { bagId: 'bag-3', x: 57, y: 39.5 },
    { bagId: 'bag-4', x: 74, y: 35.5 },
    // front 3 — nest under back with light vertical overlap
    { bagId: 'bag-5', x: 31, y: 49 },
    { bagId: 'bag-6', x: 50, y: 53 },
    { bagId: 'bag-7', x: 68, y: 50.5 },
  ],
  8: [
    // back 4
    { bagId: 'bag-1', x: 18, y: 38 },
    { bagId: 'bag-2', x: 34, y: 34 },
    { bagId: 'bag-3', x: 50, y: 39 },
    { bagId: 'bag-4', x: 65, y: 35.5 },
    // front 3 — same height band as bag-8
    { bagId: 'bag-5', x: 26, y: 51 },
    { bagId: 'bag-6', x: 42, y: 54.5 },
    { bagId: 'bag-7', x: 57, y: 52 },
    // bag-8: front height, slightly right of the front trio
    { bagId: 'bag-8', x: 80, y: 55 },
  ],
}

export function getFormation(bagCount: BagCount): readonly FormationSlot[] {
  return FORMATIONS[bagCount]
}

/** Bags used for a given count — always bag-1 … bag-N in order. */
export function bagsForCount(bagCount: BagCount): readonly BagId[] {
  return BAG_IDS.slice(0, bagCount)
}

export function isBagCount(value: number): value is BagCount {
  return (BAG_COUNTS as readonly number[]).includes(value)
}
