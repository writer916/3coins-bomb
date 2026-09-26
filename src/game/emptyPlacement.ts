import type { BagId } from './assets'
import { BAG_VISUAL_CENTER_OFFSET } from './bombPlacement'
import {
  bagDepthZIndex,
  getFormation,
  type BagCount,
} from './formations'

export type EmptyPlacement = {
  readonly bagId: BagId
  readonly bagCount: BagCount
  /** Slot formation % (unchanged). */
  readonly slotX: number
  readonly slotY: number
  /**
   * Translate from slot center onto the bag’s visual center,
   * in bag-size fractions (no collision nudge).
   */
  readonly offsetXBag: number
  readonly offsetYBag: number
  /** Same depth rule as the opened bag slot (`bagDepthZIndex`). */
  readonly depthZIndex: number
}

export type EmptyPlacementInput = {
  readonly bagId: BagId
  readonly bagCount: BagCount
}

/**
 * EMPTY label at the opened bag’s visual center.
 * Reuses bag alpha mass-center offsets + shared depth helper.
 * No secondary collision avoidance — depth handles overlaps.
 */
export function resolveEmptyPlacement(input: EmptyPlacementInput): EmptyPlacement {
  const { bagId, bagCount } = input
  const slots = getFormation(bagCount)
  const slot = slots.find((s) => s.bagId === bagId)
  if (!slot) {
    throw new Error(`resolveEmptyPlacement: unknown bag ${bagId} for count ${bagCount}`)
  }

  const visual = BAG_VISUAL_CENTER_OFFSET[bagId]

  return {
    bagId,
    bagCount,
    slotX: slot.x,
    slotY: slot.y,
    offsetXBag: visual.x,
    offsetYBag: visual.y,
    depthZIndex: bagDepthZIndex(bagCount, bagId),
  }
}
