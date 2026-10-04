import type { BagId } from './assets'
import {
  FORMATIONS,
  getFormation,
  isBagCount,
  type BagCount,
  type FormationSlot,
} from './formations'

export type DuelMatchDetailOpenOrderSide = 'above' | 'below'

export type DuelMatchDetailOpenInput = {
  readonly openOrder: number
  readonly bagNumber: number
}

export type DuelMatchDetailOpenMarker = {
  readonly openOrder: number
  readonly bagNumber: number
  readonly bagId: BagId
  readonly x: number
  readonly y: number
  readonly side: DuelMatchDetailOpenOrderSide
}

/**
 * Single-row counts keep every OPEN marker above the bag.
 * Multi-row counts (5–8) place back-row markers above and front-row markers below.
 * Row membership comes from the largest Y gap in FORMATIONS (not bag-number CSS).
 */
export function openOrderMarkerSideForBag(
  bagCount: BagCount,
  bagId: BagId,
): DuelMatchDetailOpenOrderSide {
  if (bagCount <= 4) return 'above'
  const slots = getFormation(bagCount)
  const slot = slots.find((entry) => entry.bagId === bagId)
  if (!slot) {
    throw new Error(`openOrderMarkerSideForBag: ${bagId} missing in ${bagCount}`)
  }
  const frontThreshold = frontRowYThreshold(slots)
  return slot.y >= frontThreshold ? 'below' : 'above'
}

/** Lowest Y that belongs to the front row (inclusive). */
export function frontRowYThreshold(slots: readonly FormationSlot[]): number {
  if (slots.length < 2) return Number.POSITIVE_INFINITY
  const ys = [...slots.map((slot) => slot.y)].sort((a, b) => a - b)
  let bestGap = -1
  let splitAfter = 0
  for (let index = 0; index < ys.length - 1; index += 1) {
    const gap = ys[index + 1]! - ys[index]!
    if (gap > bestGap) {
      bestGap = gap
      splitAfter = index
    }
  }
  return ys[splitAfter + 1]!
}

export function bagNumberToDetailBagId(bagNumber: number): BagId {
  if (!Number.isInteger(bagNumber) || bagNumber < 1 || bagNumber > 8) {
    throw new Error(`Invalid detail bagNumber: ${bagNumber}`)
  }
  return `bag-${bagNumber}` as BagId
}

/** coin_bag_numbers (length 3, duplicates allowed) → bagId coin counts. */
export function coinCountsByBagFromNumbers(
  coinBagNumbers: readonly number[],
): Readonly<Partial<Record<BagId, 1 | 2 | 3>>> {
  const tallies = new Map<number, number>()
  for (const bagNumber of coinBagNumbers) {
    tallies.set(bagNumber, (tallies.get(bagNumber) ?? 0) + 1)
  }
  const out: Partial<Record<BagId, 1 | 2 | 3>> = {}
  for (const [bagNumber, count] of tallies) {
    if (count < 1 || count > 3) {
      throw new Error(`Invalid coin tally for bag ${bagNumber}: ${count}`)
    }
    out[bagNumberToDetailBagId(bagNumber)] = count as 1 | 2 | 3
  }
  return out
}

export function buildDuelMatchDetailOpenMarkers(
  bagCount: BagCount,
  opens: readonly DuelMatchDetailOpenInput[],
): readonly DuelMatchDetailOpenMarker[] {
  const slots = getFormation(bagCount)
  const byBag = new Map(slots.map((slot) => [slot.bagId, slot]))
  const seenBags = new Set<number>()
  return opens.map((opened, index) => {
    if (opened.openOrder !== index + 1) {
      throw new Error('Detail opens must be sorted by openOrder without gaps')
    }
    if (
      !Number.isInteger(opened.bagNumber) ||
      opened.bagNumber < 1 ||
      opened.bagNumber > bagCount
    ) {
      throw new Error(`Open bagNumber out of range: ${opened.bagNumber}`)
    }
    if (seenBags.has(opened.bagNumber)) {
      throw new Error(`Duplicate open bagNumber: ${opened.bagNumber}`)
    }
    seenBags.add(opened.bagNumber)
    const bagId = bagNumberToDetailBagId(opened.bagNumber)
    const slot = byBag.get(bagId)
    if (!slot) throw new Error(`Missing formation slot for ${bagId}`)
    return {
      openOrder: opened.openOrder,
      bagNumber: opened.bagNumber,
      bagId,
      x: slot.x,
      y: slot.y,
      side: openOrderMarkerSideForBag(bagCount, bagId),
    }
  })
}

export function assertDetailBagCount(value: number): BagCount {
  if (!isBagCount(value)) {
    throw new Error(`Unsupported detail bagCount: ${value}`)
  }
  return value
}

/** Exposed for verifies — every bagId side for a count. */
export function openOrderSidesForBagCount(
  bagCount: BagCount,
): Readonly<Record<BagId, DuelMatchDetailOpenOrderSide>> {
  const out = {} as Record<BagId, DuelMatchDetailOpenOrderSide>
  for (const slot of FORMATIONS[bagCount]) {
    out[slot.bagId] = openOrderMarkerSideForBag(bagCount, slot.bagId)
  }
  return out
}
