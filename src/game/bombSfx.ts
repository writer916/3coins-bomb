import { planBombFx, type BombFxPlan } from './bombFx'

/** Single BOMB pop cue — aligned to visual fade start. */
export type BombSoundCue = {
  /** Same ms as `plan.fadeStartMs` (700). */
  readonly atMs: number
}

/**
 * Sound cue for a BOMB open — one pop at fade start.
 * Timing comes from the existing visual plan (no separate tempo).
 */
export function planBombSoundCue(bagId: BombFxPlan['bagId'] = 'bag-1'): BombSoundCue {
  return bombSoundCueFromPlan(planBombFx(bagId))
}

export function bombSoundCueFromPlan(plan: BombFxPlan): BombSoundCue {
  return { atMs: plan.fadeStartMs }
}

export type BombPopRequest =
  | { readonly play: true }
  | {
      readonly play: false
      readonly reason: 'sound-off' | 'too-early' | 'already-fired'
    }

/**
 * Gate BOMB pop intent. Pure — does not play audio.
 * Cue is consumed once `elapsedMs >= cueAtMs` (even when SOUND OFF),
 * so toggling sound mid-FX cannot re-fire.
 */
export function resolveBombPopRequest(
  soundEnabled: boolean,
  alreadyFired: boolean,
  elapsedMs: number,
  cueAtMs: number,
): BombPopRequest {
  if (alreadyFired) return { play: false, reason: 'already-fired' }
  if (elapsedMs < cueAtMs) return { play: false, reason: 'too-early' }
  if (!soundEnabled) return { play: false, reason: 'sound-off' }
  return { play: true }
}

/** True when the cue threshold has been crossed and should be marked consumed. */
export function shouldConsumeBombPopCue(
  alreadyFired: boolean,
  elapsedMs: number,
  cueAtMs: number,
): boolean {
  return !alreadyFired && elapsedMs >= cueAtMs
}
