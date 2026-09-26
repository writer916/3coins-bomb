import type { BagId } from './assets'

export type EmptyFxPhase = 'hold' | 'fading' | 'done'

export type EmptyFxPlan = {
  readonly bagId: BagId
  /** Full FX length (ms). First draft ~500–700ms. */
  readonly totalMs: number
  /** Bag gone almost immediately (0 = next paint). */
  readonly bagHideMs: number
  /** Elapsed ms when fade-out begins. */
  readonly fadeStartMs: number
  /** Peak opacity while held (quiet vs COIN / BOMB). */
  readonly holdOpacity: number
}

export type EmptyFxSample = {
  readonly bagId: BagId
  readonly phase: EmptyFxPhase
  readonly bagHidden: boolean
  readonly finished: boolean
  /** 0–1 opacity for the EMPTY label. */
  readonly opacity: number
}

/**
 * First-draft EMPTY open timings.
 * Visual only — does not touch ROUND state. Silent.
 */
export function planEmptyFx(bagId: BagId): EmptyFxPlan {
  return {
    bagId,
    totalMs: 600,
    bagHideMs: 0,
    fadeStartMs: 450,
    holdOpacity: 0.55,
  }
}

/**
 * Pure sample of EMPTY open FX at `elapsedMs`.
 * Label stays at the opened bag’s visual center (no motion).
 */
export function sampleEmptyFx(plan: EmptyFxPlan, elapsedMs: number): EmptyFxSample {
  if (elapsedMs < 0) {
    return {
      bagId: plan.bagId,
      phase: 'hold',
      bagHidden: false,
      finished: false,
      opacity: 0,
    }
  }

  if (elapsedMs >= plan.totalMs) {
    return {
      bagId: plan.bagId,
      phase: 'done',
      bagHidden: true,
      finished: true,
      opacity: 0,
    }
  }

  const bagHidden = elapsedMs >= plan.bagHideMs
  const fading = elapsedMs >= plan.fadeStartMs

  let opacity = plan.holdOpacity
  if (fading) {
    const span = plan.totalMs - plan.fadeStartMs
    const t = span <= 0 ? 1 : (elapsedMs - plan.fadeStartMs) / span
    opacity = plan.holdOpacity * (1 - Math.max(0, Math.min(1, t)))
  }

  return {
    bagId: plan.bagId,
    phase: fading ? 'fading' : 'hold',
    bagHidden,
    finished: false,
    opacity,
  }
}
