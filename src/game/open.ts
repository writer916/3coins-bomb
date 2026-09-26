import type { BagId } from './assets'
import { getBagContents, type BagContents, type HiddenHand } from './hand'

/** One successful open, in chronological order. */
export type OpenReveal = {
  readonly bagId: BagId
  /** 0-based open order within the ROUND. */
  readonly order: number
  readonly contents: BagContents
}

export type TryOpenOk = {
  readonly ok: true
  readonly reveal: OpenReveal
  readonly history: readonly OpenReveal[]
}

export type TryOpenFail = {
  readonly ok: false
  readonly reason: 'already-opened' | 'unknown-bag'
  readonly history: readonly OpenReveal[]
}

export type TryOpenResult = TryOpenOk | TryOpenFail

export function isBagOpened(
  history: readonly OpenReveal[],
  bagId: BagId,
): boolean {
  return history.some((entry) => entry.bagId === bagId)
}

export function openedBagIds(history: readonly OpenReveal[]): ReadonlySet<BagId> {
  return new Set(history.map((entry) => entry.bagId))
}

/**
 * Pure open step. Never mutates `hand` or `history`.
 * Same bagId twice → already-opened (history unchanged).
 */
export function tryOpenBag(
  hand: HiddenHand,
  history: readonly OpenReveal[],
  bagId: BagId,
): TryOpenResult {
  if (isBagOpened(history, bagId)) {
    return { ok: false, reason: 'already-opened', history }
  }

  const known = hand.bags.some((b) => b.bagId === bagId)
  if (!known) {
    return { ok: false, reason: 'unknown-bag', history }
  }

  const contents = getBagContents(hand, bagId)
  const reveal: OpenReveal = {
    bagId,
    order: history.length,
    contents,
  }
  const nextHistory = [...history, reveal]

  return { ok: true, reveal, history: nextHistory }
}

/** Dev-facing short label for provisional UI (not final copy). */
export function formatOpenResultLabel(contents: BagContents): string {
  switch (contents.kind) {
    case 'empty':
      return 'EMPTY'
    case 'bomb':
      return 'BOMB'
    case 'coins':
      return `COIN ×${contents.coinCount}`
    default: {
      const _exhaustive: never = contents
      return String(_exhaustive)
    }
  }
}
