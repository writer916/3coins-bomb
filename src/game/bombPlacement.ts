import type { BagId } from './assets'
import {
  bagDepthZIndex,
  getFormation,
  type BagCount,
} from './formations'

/** Bomb display size as fraction of `--bag-size` (must match BombOpenFx.css). */
export const BOMB_SIZE_FRAC_OF_BAG = 0.52

/**
 * Bag opaque mass-center offset from the square image / slot center,
 * as a fraction of bag display size (+x right, +y down).
 *
 * Measured from public/assets/game/bag-N.webp alpha (threshold 24)
 * via weighted center of mass — not bbox (drawstring skews bbox less than mass).
 */
export const BAG_VISUAL_CENTER_OFFSET: Readonly<
  Record<BagId, { readonly x: number; readonly y: number }>
> = {
  'bag-1': { x: 0.0126, y: 0.0629 },
  'bag-2': { x: 0.036, y: 0.0737 },
  'bag-3': { x: -0.0106, y: 0.0553 },
  'bag-4': { x: -0.0068, y: 0.0747 },
  'bag-5': { x: -0.0032, y: 0.0596 },
  'bag-6': { x: -0.0129, y: 0.0783 },
  'bag-7': { x: -0.006, y: 0.0669 },
  'bag-8': { x: -0.0149, y: 0.068 },
}

/**
 * bomb-off.webp mass-center offset from image center (fraction of bomb size).
 * Used so the drawn bomb body (not transparent padding) sits on the bag center.
 * Shared for off→on so the wrapper does not jump on ignite.
 */
export const BOMB_SPRITE_CENTER_OFFSET = {
  x: -0.0515,
  y: 0.0403,
} as const

/** Max secondary collision nudge, in bag-size fractions. */
export const BOMB_MAX_SECONDARY_OFFSET = 0.08

/**
 * Approximate bag display width / board width for collision math.
 * Matches CSS clamp mid-band on ~375px phone boards (vw terms in BagBoard.css).
 */
export const BAG_SIZE_FRAC_OF_BOARD_WIDTH: Readonly<Record<BagCount, number>> = {
  3: 0.3,
  4: 0.245,
  5: 0.275,
  6: 0.235,
  7: 0.225,
  8: 0.215,
}

const BOARD_ASPECT_H_OVER_W = 5 / 4

export type BombPlacement = {
  readonly bagId: BagId
  readonly bagCount: BagCount
  /** Slot formation % (unchanged). */
  readonly slotX: number
  readonly slotY: number
  /**
   * Extra translate from slot center, in bag-size fractions
   * (applied as `var(--bag-size) * offset` in CSS).
   */
  readonly offsetXBag: number
  readonly offsetYBag: number
  /** Visual-center term only (before collision). */
  readonly visualOffsetXBag: number
  readonly visualOffsetYBag: number
  /** Secondary collision nudge (within BOMB_MAX_SECONDARY_OFFSET). */
  readonly secondaryOffsetXBag: number
  readonly secondaryOffsetYBag: number
  /** Same depth rule as the opened bag slot (`bagDepthZIndex`). */
  readonly depthZIndex: number
}

export type BombPlacementInput = {
  readonly bagId: BagId
  readonly bagCount: BagCount
  /** Bags still on the board (not yet opened / not the bomb bag). */
  readonly remainingBagIds: readonly BagId[]
}

function bagVisual(bagId: BagId): { x: number; y: number } {
  return BAG_VISUAL_CENTER_OFFSET[bagId]
}

/**
 * Offset that places the bomb sprite's visual center on the bag's visual center.
 * Units: bag-size fractions from the formation slot center.
 */
export function visualCenterOffsetBag(bagId: BagId): {
  readonly x: number
  readonly y: number
} {
  const bag = bagVisual(bagId)
  return {
    x: bag.x - BOMB_SPRITE_CENTER_OFFSET.x * BOMB_SIZE_FRAC_OF_BAG,
    y: bag.y - BOMB_SPRITE_CENTER_OFFSET.y * BOMB_SIZE_FRAC_OF_BAG,
  }
}

/** Small deterministic candidate nudges (bag-size fractions). */
const SECONDARY_CANDIDATES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.04, 0],
  [-0.04, 0],
  [0, 0.04],
  [0, -0.04],
  [0.03, 0.03],
  [0.03, -0.03],
  [-0.03, 0.03],
  [-0.03, -0.03],
  [0.05, 0.02],
  [-0.05, 0.02],
  [0.05, -0.02],
  [-0.05, -0.02],
  [0.02, 0.05],
  [-0.02, 0.05],
  [0.02, -0.05],
  [-0.02, -0.05],
  [0.06, 0],
  [-0.06, 0],
  [0, 0.06],
  [0, -0.06],
]

function clampSecondary(x: number, y: number): { x: number; y: number } {
  const lim = BOMB_MAX_SECONDARY_OFFSET
  const len = Math.hypot(x, y)
  if (len <= lim || len === 0) return { x, y }
  const s = lim / len
  return { x: x * s, y: y * s }
}

/**
 * Board % → bag-size fraction deltas for the active bagCount.
 */
function boardPctToBagFrac(
  dxPct: number,
  dyPct: number,
  bagCount: BagCount,
): { x: number; y: number } {
  const bagW = BAG_SIZE_FRAC_OF_BOARD_WIDTH[bagCount]
  const bagH = bagW // square bags
  // dxPct is % of board width; dyPct % of board height
  return {
    x: dxPct / 100 / bagW,
    y: (dyPct / 100) * BOARD_ASPECT_H_OVER_W / bagH,
  }
}

function overlapPenalty(
  bombX: number,
  bombY: number,
  neighbors: readonly { x: number; y: number }[],
): number {
  const bombR = BOMB_SIZE_FRAC_OF_BAG * 0.5
  const neighborR = 0.45
  let penalty = 0
  for (const n of neighbors) {
    const d = Math.hypot(bombX - n.x, bombY - n.y)
    // Soft: only penalize substantial coverage, not light edge kisses.
    const overlap = bombR + neighborR - d
    if (overlap > 0.04) penalty += overlap * overlap
  }
  return penalty
}

/**
 * Resolve BOMB placement: visual center first, then tiny collision nudge if needed.
 * Pure / deterministic. Does not mutate formations.
 */
export function resolveBombPlacement(input: BombPlacementInput): BombPlacement {
  const { bagId, bagCount, remainingBagIds } = input
  const slots = getFormation(bagCount)
  const slot = slots.find((s) => s.bagId === bagId)
  if (!slot) {
    throw new Error(`resolveBombPlacement: unknown bag ${bagId} for count ${bagCount}`)
  }

  const visual = visualCenterOffsetBag(bagId)

  const neighbors: { x: number; y: number }[] = []
  for (const id of remainingBagIds) {
    if (id === bagId) continue
    const ns = slots.find((s) => s.bagId === id)
    if (!ns) continue
    const nv = bagVisual(id)
    const delta = boardPctToBagFrac(ns.x - slot.x, ns.y - slot.y, bagCount)
    neighbors.push({
      x: delta.x + nv.x,
      y: delta.y + nv.y,
    })
  }

  const basePenalty = overlapPenalty(visual.x, visual.y, neighbors)

  let bestSec = { x: 0, y: 0 }
  let bestScore = basePenalty

  // Only search nudges when the visual-center pose already overlaps noticeably.
  if (basePenalty > 0.002) {
    for (const [cx, cy] of SECONDARY_CANDIDATES) {
      const sec = clampSecondary(cx, cy)
      const px = visual.x + sec.x
      const py = visual.y + sec.y
      const pen = overlapPenalty(px, py, neighbors)
      const dist = Math.hypot(sec.x, sec.y)
      // Prefer less overlap, then smaller move from visual center.
      const score = pen * 10 + dist
      if (score < bestScore - 1e-9) {
        bestScore = score
        bestSec = sec
      }
    }
  }

  return {
    bagId,
    bagCount,
    slotX: slot.x,
    slotY: slot.y,
    visualOffsetXBag: visual.x,
    visualOffsetYBag: visual.y,
    secondaryOffsetXBag: bestSec.x,
    secondaryOffsetYBag: bestSec.y,
    offsetXBag: visual.x + bestSec.x,
    offsetYBag: visual.y + bestSec.y,
    depthZIndex: bagDepthZIndex(bagCount, bagId),
  }
}

/** Total offset magnitude from slot (bag-size frac) — for verify caps. */
export function bombPlacementOffsetMagnitude(p: BombPlacement): number {
  return Math.hypot(p.offsetXBag, p.offsetYBag)
}
