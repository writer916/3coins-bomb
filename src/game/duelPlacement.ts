import type { BagId } from './assets'
import { BAG_COUNTS, type BagCount } from './formations'

/** DUEL match length (ROUND count choice). */
export const DUEL_ROUNDS_MIN = 1
export const DUEL_ROUNDS_MAX = 20
export const DUEL_ROUNDS_DEFAULT = 5

/** Per-ROUND bag count before SET. */
export const DUEL_BAGS_MIN = 3
export const DUEL_BAGS_MAX = 8
export const DUEL_BAGS_DEFAULT = 5

export const DUEL_COIN_TOTAL = 3

export type DuelRoundDraftPhase =
  | 'select-bags'
  | 'place-bomb'
  | 'place-coins'
  | 'ready'

/** Finished ROUND placement — server-friendly pure structure. */
export type DuelRoundPlacement = {
  readonly roundNumber: number
  readonly bagCount: BagCount
  readonly bombBagId: BagId
  /** Coin count per bag (BOMB bag omitted / never present). */
  readonly coinCountsByBag: Readonly<Partial<Record<BagId, 1 | 2 | 3>>>
}

export type DuelRoundDraft = {
  readonly roundNumber: number
  readonly bagsDraft: number
  readonly bagsSet: boolean
  readonly bagCount: BagCount | null
  readonly bombBagId: BagId | null
  readonly coinCountsByBag: Readonly<Partial<Record<BagId, 1 | 2 | 3>>>
  readonly phase: DuelRoundDraftPhase
}

export type DuelPlacementSession = {
  readonly totalRounds: number
  readonly completed: readonly DuelRoundPlacement[]
  readonly current: DuelRoundDraft | null
  /** All ROUNDs filled; awaiting LOCK or START OVER. */
  readonly awaitingLock: boolean
  /** Irreversible local lock (no server yet). */
  readonly locked: boolean
}

export function clampDuelRounds(n: number): number {
  if (!Number.isFinite(n)) return DUEL_ROUNDS_DEFAULT
  return Math.min(DUEL_ROUNDS_MAX, Math.max(DUEL_ROUNDS_MIN, Math.round(n)))
}

export function clampDuelBags(n: number): number {
  if (!Number.isFinite(n)) return DUEL_BAGS_DEFAULT
  return Math.min(DUEL_BAGS_MAX, Math.max(DUEL_BAGS_MIN, Math.round(n)))
}

export function isBagCount(n: number): n is BagCount {
  return (BAG_COUNTS as readonly number[]).includes(n)
}

export function createEmptyDraft(roundNumber: number): DuelRoundDraft {
  return {
    roundNumber,
    bagsDraft: DUEL_BAGS_DEFAULT,
    bagsSet: false,
    bagCount: null,
    bombBagId: null,
    coinCountsByBag: {},
    phase: 'select-bags',
  }
}

export function createDuelSession(totalRounds: number): DuelPlacementSession {
  const n = clampDuelRounds(totalRounds)
  return {
    totalRounds: n,
    completed: [],
    current: createEmptyDraft(1),
    awaitingLock: false,
    locked: false,
  }
}

export function totalCoins(
  coins: Readonly<Partial<Record<BagId, 1 | 2 | 3>>>,
): number {
  let sum = 0
  for (const v of Object.values(coins)) {
    if (typeof v === 'number') sum += v
  }
  return sum
}

export function isValidCompletedPlacement(p: DuelRoundPlacement): boolean {
  if (!isBagCount(p.bagCount)) return false
  if (p.coinCountsByBag[p.bombBagId] != null) return false
  if (totalCoins(p.coinCountsByBag) !== DUEL_COIN_TOTAL) return false
  for (const [id, count] of Object.entries(p.coinCountsByBag)) {
    if (count == null) continue
    if (count < 1 || count > 3) return false
    const bagNum = Number(String(id).replace(/^bag-/, ''))
    if (!Number.isInteger(bagNum) || bagNum < 1 || bagNum > p.bagCount) {
      return false
    }
  }
  return true
}

export function isDraftReady(draft: DuelRoundDraft): boolean {
  if (!draft.bagsSet || draft.bagCount == null || draft.bombBagId == null) {
    return false
  }
  if (draft.phase !== 'ready') return false
  return (
    totalCoins(draft.coinCountsByBag) === DUEL_COIN_TOTAL &&
    draft.coinCountsByBag[draft.bombBagId] == null
  )
}

export function setBagsDraft(
  draft: DuelRoundDraft,
  next: number,
): DuelRoundDraft {
  if (draft.bagsSet || draft.phase !== 'select-bags') return draft
  return { ...draft, bagsDraft: clampDuelBags(next) }
}

/** SET — lock bagCount and show formation. */
export function confirmBags(draft: DuelRoundDraft): DuelRoundDraft {
  if (draft.bagsSet || draft.phase !== 'select-bags') return draft
  const bagCount = clampDuelBags(draft.bagsDraft)
  if (!isBagCount(bagCount)) return draft
  return {
    ...draft,
    bagsDraft: bagCount,
    bagsSet: true,
    bagCount,
    bombBagId: null,
    coinCountsByBag: {},
    phase: 'place-bomb',
  }
}

export function placeBomb(
  draft: DuelRoundDraft,
  bagId: BagId,
): DuelRoundDraft {
  if (draft.phase !== 'place-bomb' || !draft.bagsSet || draft.bagCount == null) {
    return draft
  }
  const n = Number(String(bagId).replace(/^bag-/, ''))
  if (!Number.isInteger(n) || n < 1 || n > draft.bagCount) return draft
  return {
    ...draft,
    bombBagId: bagId,
    coinCountsByBag: {},
    phase: 'place-coins',
  }
}

export function placeCoin(
  draft: DuelRoundDraft,
  bagId: BagId,
): DuelRoundDraft {
  if (draft.phase !== 'place-coins' || draft.bombBagId == null) return draft
  if (bagId === draft.bombBagId) return draft
  if (totalCoins(draft.coinCountsByBag) >= DUEL_COIN_TOTAL) return draft
  if (draft.bagCount == null) return draft
  const n = Number(String(bagId).replace(/^bag-/, ''))
  if (!Number.isInteger(n) || n < 1 || n > draft.bagCount) return draft

  const prev = draft.coinCountsByBag[bagId] ?? 0
  if (prev >= 3) return draft
  const nextCount = (prev + 1) as 1 | 2 | 3
  const nextCoins = { ...draft.coinCountsByBag, [bagId]: nextCount }
  const sum = totalCoins(nextCoins)
  return {
    ...draft,
    coinCountsByBag: nextCoins,
    phase: sum >= DUEL_COIN_TOTAL ? 'ready' : 'place-coins',
  }
}

/**
 * Place-screen RESET — clear BOMB/COIN on this ROUND only.
 * Keeps roundNumber, bagCount / formation; stays on place-bomb (no screen change).
 */
export function resetCurrentRound(draft: DuelRoundDraft): DuelRoundDraft {
  if (!draft.bagsSet || draft.bagCount == null) return draft
  if (
    draft.phase !== 'place-bomb' &&
    draft.phase !== 'place-coins' &&
    draft.phase !== 'ready'
  ) {
    return draft
  }
  return {
    ...draft,
    bombBagId: null,
    coinCountsByBag: {},
    phase: 'place-bomb',
  }
}

/**
 * Place-screen BACK — return to this ROUND's BAGS setup.
 * Keeps bagsDraft (= prior bagCount); discards BOMB/COIN placement.
 */
export function backToBagsFromPlace(draft: DuelRoundDraft): DuelRoundDraft {
  if (
    draft.phase !== 'place-bomb' &&
    draft.phase !== 'place-coins' &&
    draft.phase !== 'ready'
  ) {
    return draft
  }
  const bags = draft.bagCount ?? draft.bagsDraft
  return {
    roundNumber: draft.roundNumber,
    bagsDraft: clampDuelBags(bags),
    bagsSet: false,
    bagCount: null,
    bombBagId: null,
    coinCountsByBag: {},
    phase: 'select-bags',
  }
}

export function draftToPlacement(
  draft: DuelRoundDraft,
): DuelRoundPlacement | null {
  if (!isDraftReady(draft) || draft.bagCount == null || draft.bombBagId == null) {
    return null
  }
  const placement: DuelRoundPlacement = {
    roundNumber: draft.roundNumber,
    bagCount: draft.bagCount,
    bombBagId: draft.bombBagId,
    coinCountsByBag: { ...draft.coinCountsByBag },
  }
  return isValidCompletedPlacement(placement) ? placement : null
}

/** NEXT ROUND — save current, open next (or stay if already last — use complete). */
export function commitAndAdvance(
  session: DuelPlacementSession,
): DuelPlacementSession {
  if (session.locked || session.awaitingLock || !session.current) return session
  const placement = draftToPlacement(session.current)
  if (!placement) return session
  if (session.current.roundNumber >= session.totalRounds) return session

  const completed = [...session.completed, placement]
  const nextNum = session.current.roundNumber + 1
  return {
    ...session,
    completed,
    current: createEmptyDraft(nextNum),
    awaitingLock: false,
  }
}

/** COMPLETE on final READY ROUND. */
export function completeSession(
  session: DuelPlacementSession,
): DuelPlacementSession {
  if (session.locked || session.awaitingLock || !session.current) return session
  if (session.current.roundNumber !== session.totalRounds) return session
  const placement = draftToPlacement(session.current)
  if (!placement) return session
  return {
    ...session,
    completed: [...session.completed, placement],
    current: null,
    awaitingLock: true,
  }
}

/** START OVER — keep totalRounds, clear all placements. */
export function startOverSession(
  session: DuelPlacementSession,
): DuelPlacementSession {
  if (session.locked) return session
  return createDuelSession(session.totalRounds)
}

export function lockSession(
  session: DuelPlacementSession,
): DuelPlacementSession {
  if (!session.awaitingLock || session.locked) return session
  if (session.completed.length !== session.totalRounds) return session
  if (!session.completed.every(isValidCompletedPlacement)) return session
  return {
    ...session,
    locked: true,
    awaitingLock: true,
    current: null,
  }
}

export function canNextRound(session: DuelPlacementSession): boolean {
  if (!session.current || session.locked || session.awaitingLock) return false
  if (session.current.roundNumber >= session.totalRounds) return false
  return isDraftReady(session.current)
}

export function canComplete(session: DuelPlacementSession): boolean {
  if (!session.current || session.locked || session.awaitingLock) return false
  if (session.current.roundNumber !== session.totalRounds) return false
  return isDraftReady(session.current)
}

/**
 * True once any ROUND placement work has begun (needs BACK confirm).
 * Pristine ROUND 1 / bags unset / empty completed → false.
 */
export function hasPlacementProgress(session: DuelPlacementSession): boolean {
  if (session.locked || session.awaitingLock) return true
  if (session.completed.length > 0) return true
  const d = session.current
  if (!d) return true
  if (d.roundNumber !== 1) return true
  if (d.phase !== 'select-bags') return true
  if (d.bagsSet || d.bagCount != null) return true
  if (d.bombBagId != null) return true
  if (totalCoins(d.coinCountsByBag) > 0) return true
  return false
}
