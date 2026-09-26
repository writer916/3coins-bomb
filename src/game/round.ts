import type { BagId } from './assets'
import { generateSoloSystemHand, type HiddenHand } from './hand'
import {
  tryOpenBag,
  type OpenReveal,
  type TryOpenFail,
} from './open'

export type RoundPhase = 'active' | 'cashed-out' | 'cleared' | 'bombed'

export type RoundState = {
  readonly hand: HiddenHand
  readonly history: readonly OpenReveal[]
  readonly lastReveal: OpenReveal | null
  readonly phase: RoundPhase
  /** Coins found this ROUND before settle (0–3). */
  readonly provisionalCoins: number
  /** Settled take for the ROUND; null while active. */
  readonly capturedCoins: number | null
}

export function createActiveRound(hand?: HiddenHand): RoundState {
  return {
    hand: hand ?? generateSoloSystemHand(),
    history: [],
    lastReveal: null,
    phase: 'active',
    provisionalCoins: 0,
    capturedCoins: null,
  }
}

export function isRoundActive(state: RoundState): boolean {
  return state.phase === 'active'
}

export function isRoundEnded(state: RoundState): boolean {
  return state.phase !== 'active'
}

/** CASH OUT only with provisional 1 or 2 while active. */
export function canCashOut(state: RoundState): boolean {
  return (
    state.phase === 'active' &&
    (state.provisionalCoins === 1 || state.provisionalCoins === 2)
  )
}

export type ApplyOpenOk = {
  readonly ok: true
  readonly state: RoundState
  readonly reveal: OpenReveal
}

export type ApplyOpenFail = {
  readonly ok: false
  readonly reason: 'round-ended' | TryOpenFail['reason']
  readonly state: RoundState
}

export type ApplyOpenResult = ApplyOpenOk | ApplyOpenFail

/**
 * Apply one bag open under ROUND rules.
 * Never mutates `hand`. Ended rounds reject further opens.
 */
export function applyOpenBag(state: RoundState, bagId: BagId): ApplyOpenResult {
  if (state.phase !== 'active') {
    return { ok: false, reason: 'round-ended', state }
  }

  const opened = tryOpenBag(state.hand, state.history, bagId)
  if (!opened.ok) {
    return { ok: false, reason: opened.reason, state }
  }

  const { reveal, history } = opened
  let provisionalCoins = state.provisionalCoins
  let phase: RoundPhase = 'active'
  let capturedCoins: number | null = null

  if (reveal.contents.kind === 'coins') {
    provisionalCoins += reveal.contents.coinCount
    if (provisionalCoins > 3) {
      throw new Error(
        `applyOpenBag: provisionalCoins ${provisionalCoins} exceeded 3 (invalid hand?)`,
      )
    }
    if (provisionalCoins === 3) {
      phase = 'cleared'
      capturedCoins = 3
    }
  } else if (reveal.contents.kind === 'bomb') {
    phase = 'bombed'
    capturedCoins = 0
    provisionalCoins = 0
  }
  // empty: provisional unchanged, stay active

  return {
    ok: true,
    reveal,
    state: {
      hand: state.hand,
      history,
      lastReveal: reveal,
      phase,
      provisionalCoins,
      capturedCoins,
    },
  }
}

export type CashOutOk = {
  readonly ok: true
  readonly state: RoundState
}

export type CashOutFail = {
  readonly ok: false
  readonly reason: 'not-allowed'
  readonly state: RoundState
}

export type CashOutResult = CashOutOk | CashOutFail

export function tryCashOut(state: RoundState): CashOutResult {
  if (!canCashOut(state)) {
    return { ok: false, reason: 'not-allowed', state }
  }

  return {
    ok: true,
    state: {
      ...state,
      phase: 'cashed-out',
      capturedCoins: state.provisionalCoins,
    },
  }
}
