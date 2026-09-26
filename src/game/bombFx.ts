import type { BagId, BombId } from './assets'

export type BombFxPhase = 'off' | 'lit' | 'fading' | 'done'

export type BombFxPlan = {
  readonly bagId: BagId
  /** Full FX length (ms). First draft ~700–1000ms. */
  readonly totalMs: number
  /** Bag gone almost immediately (0 = next paint). */
  readonly bagHideMs: number
  /** Elapsed ms when fuse ignites (bomb-off → bomb-on). */
  readonly igniteMs: number
  /** Elapsed ms when fade-out begins. */
  readonly fadeStartMs: number
}

export type BombFxSample = {
  readonly bagId: BagId
  readonly frame: BombId
  readonly phase: BombFxPhase
  /** Micro-shake only while lit (before fade). */
  readonly shaking: boolean
  readonly bagHidden: boolean
  readonly finished: boolean
  /** 0–1 opacity for the bomb sprite. */
  readonly opacity: number
}

/**
 * First-draft BOMB open timings.
 * Visual only — does not touch ROUND state.
 */
export function planBombFx(bagId: BagId): BombFxPlan {
  return {
    bagId,
    totalMs: 880,
    bagHideMs: 0,
    // Short “あ” beat on bomb-off before ignition (~160ms).
    igniteMs: 160,
    fadeStartMs: 700,
  }
}

/**
 * Pure sample of BOMB open FX at `elapsedMs`.
 * Bomb stays at the opened bag’s slot (no upward flight).
 */
export function sampleBombFx(plan: BombFxPlan, elapsedMs: number): BombFxSample {
  if (elapsedMs < 0) {
    return {
      bagId: plan.bagId,
      frame: 'bomb-off',
      phase: 'off',
      shaking: false,
      bagHidden: false,
      finished: false,
      opacity: 0,
    }
  }

  if (elapsedMs >= plan.totalMs) {
    return {
      bagId: plan.bagId,
      frame: 'bomb-on',
      phase: 'done',
      shaking: false,
      bagHidden: true,
      finished: true,
      opacity: 0,
    }
  }

  const bagHidden = elapsedMs >= plan.bagHideMs
  const ignited = elapsedMs >= plan.igniteMs
  const fading = elapsedMs >= plan.fadeStartMs

  let phase: BombFxPhase
  if (!ignited) phase = 'off'
  else if (fading) phase = 'fading'
  else phase = 'lit'

  let opacity = 1
  if (fading) {
    const span = plan.totalMs - plan.fadeStartMs
    opacity = span <= 0 ? 0 : 1 - (elapsedMs - plan.fadeStartMs) / span
    opacity = Math.max(0, Math.min(1, opacity))
  }

  return {
    bagId: plan.bagId,
    frame: ignited ? 'bomb-on' : 'bomb-off',
    phase,
    shaking: ignited && !fading,
    bagHidden,
    finished: false,
    opacity,
  }
}
