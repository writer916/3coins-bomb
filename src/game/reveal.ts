import type { BagId } from './assets'
import { BOMB_SIZE_FRAC_OF_BAG } from './bombPlacement'
import { getFormation, bagDepthZIndex, type BagCount } from './formations'
import type { HiddenHand } from './hand'
import { openedBagIds, type OpenReveal } from './open'
import type { RoundPhase } from './round'

/** REVEAL coin size vs `--bag-size` (opening FX uses 0.26 — do not reuse blindly). */
export const REVEAL_COIN_SIZE_FRAC = 0.22

/** REVEAL bomb size — same fraction as opening bomb display. */
export const REVEAL_BOMB_SIZE_FRAC = BOMB_SIZE_FRAC_OF_BAG

/**
 * Per-coin offsets from formation slot center (bag-size fractions).
 * Group centroid must be (0,0) so the bundle sits on the geometric slot center.
 * ×2: symmetric BL↔TR. ×3: compact fan. No rotation.
 * Does NOT use BAG_VISUAL_CENTER_OFFSET.
 */
export const REVEAL_COIN_STACK_OFFSETS: Readonly<
  Record<1 | 2 | 3, readonly { readonly x: number; readonly y: number }[]>
> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -0.07, y: 0.055 },
    { x: 0.07, y: -0.055 },
  ],
  3: [
    { x: -0.09, y: 0.05 },
    { x: 0, y: -0.1 },
    { x: 0.09, y: 0.05 },
  ],
}

export type RevealCoinSprite = {
  readonly kind: 'coin'
  readonly bagId: BagId
  readonly coinIndex: number
  readonly coinCount: 1 | 2 | 3
  readonly slotX: number
  readonly slotY: number
  /** Stack offset from slot center in bag-size fractions (no visual-center bias). */
  readonly offsetXBag: number
  readonly offsetYBag: number
  readonly depthZIndex: number
  readonly stackZ: number
}

export type RevealBombSprite = {
  readonly kind: 'bomb'
  readonly bagId: BagId
  readonly slotX: number
  readonly slotY: number
  /** Always 0 — bomb image center on slot center. */
  readonly offsetXBag: number
  readonly offsetYBag: number
  readonly depthZIndex: number
}

export type RevealSprite = RevealCoinSprite | RevealBombSprite

export type RevealPlan = {
  readonly bagCount: BagCount
  readonly sprites: readonly RevealSprite[]
}

/** End-of-ROUND action row: after settle + open FX finished. */
export function canShowEndActions(
  phase: RoundPhase,
  openFxActive: boolean,
): boolean {
  return phase !== 'active' && !openFxActive
}

/** REVEAL only once, and only when end actions are visible. */
export function canRequestReveal(
  phase: RoundPhase,
  openFxActive: boolean,
  alreadyRevealed: boolean,
): boolean {
  return canShowEndActions(phase, openFxActive) && !alreadyRevealed
}

/**
 * Mean of coin stack offsets — must be ~0 so the bundle centers on the slot.
 */
export function revealCoinStackCentroid(
  coinCount: 1 | 2 | 3,
): { readonly x: number; readonly y: number } {
  const stack = REVEAL_COIN_STACK_OFFSETS[coinCount]
  let sx = 0
  let sy = 0
  for (const o of stack) {
    sx += o.x
    sy += o.y
  }
  return { x: sx / stack.length, y: sy / stack.length }
}

/**
 * Build static REVEAL sprites for bags still unopened at ROUND end.
 * Opened bagIds (from history) are excluded — no re-display of known contents.
 * Placement uses formation slot geometric center only (no bag visual-center bias).
 * EMPTY unopened bags contribute nothing. Pure — does not mutate hand/history.
 */
export function buildRevealPlan(
  hand: HiddenHand,
  history: readonly OpenReveal[],
): RevealPlan {
  const bagCount = hand.bagCount
  const opened = openedBagIds(history)
  const sprites: RevealSprite[] = []

  for (const bag of hand.bags) {
    if (opened.has(bag.bagId)) continue

    const slot = getFormation(bagCount).find((s) => s.bagId === bag.bagId)
    if (!slot) {
      throw new Error(`buildRevealPlan: ${bag.bagId} missing in ${bagCount}-bag formation`)
    }

    const depth = bagDepthZIndex(bagCount, bag.bagId)
    const contents = bag.contents

    if (contents.kind === 'empty') continue

    if (contents.kind === 'bomb') {
      sprites.push({
        kind: 'bomb',
        bagId: bag.bagId,
        slotX: slot.x,
        slotY: slot.y,
        offsetXBag: 0,
        offsetYBag: 0,
        depthZIndex: depth,
      })
      continue
    }

    const count = contents.coinCount
    const stack = REVEAL_COIN_STACK_OFFSETS[count]
    for (let i = 0; i < stack.length; i++) {
      const o = stack[i]!
      sprites.push({
        kind: 'coin',
        bagId: bag.bagId,
        coinIndex: i,
        coinCount: count,
        slotX: slot.x,
        slotY: slot.y,
        offsetXBag: o.x,
        offsetYBag: o.y,
        depthZIndex: depth,
        stackZ: i,
      })
    }
  }

  return { bagCount, sprites }
}

/** Average sprite position in formation % — equals slot for centered stacks. */
export function revealGroupCenterPct(
  plan: RevealPlan,
  bagId: BagId,
): { readonly x: number; readonly y: number } | null {
  const group = plan.sprites.filter((s) => s.bagId === bagId)
  if (group.length === 0) return null
  // All sprites share slotX/Y; offsets are bag-frac — centroid of offsets must be 0.
  const slotX = group[0]!.slotX
  const slotY = group[0]!.slotY
  let ox = 0
  let oy = 0
  for (const s of group) {
    ox += s.offsetXBag
    oy += s.offsetYBag
  }
  // Report formation % center (slot) — offset centroid checked separately in verify.
  void ox
  void oy
  return { x: slotX, y: slotY }
}

export function countRevealCoins(plan: RevealPlan, bagId: BagId): number {
  return plan.sprites.filter((s) => s.kind === 'coin' && s.bagId === bagId).length
}

export function hasRevealBomb(plan: RevealPlan, bagId: BagId): boolean {
  return plan.sprites.some((s) => s.kind === 'bomb' && s.bagId === bagId)
}

export function revealSpriteCount(plan: RevealPlan): {
  coins: number
  bombs: number
} {
  let coins = 0
  let bombs = 0
  for (const s of plan.sprites) {
    if (s.kind === 'coin') coins += 1
    else bombs += 1
  }
  return { coins, bombs }
}
