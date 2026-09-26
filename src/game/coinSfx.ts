import { planCoinFx, type CoinFxPlan, type FxCoinCount } from './coinFx'

/** One chime aligned to a cumulative +N display beat. */
export type CoinSoundCue = {
  readonly step: 1 | 2 | 3
  /** Same ms as the matching `plan.totalAtMs` entry. */
  readonly atMs: number
}

/**
 * Sound cues for a COIN open — one chime per cumulative label step.
 * Timing is taken from the existing visual plan (no separate tempo).
 */
export function planCoinSoundCues(coinCount: FxCoinCount): readonly CoinSoundCue[] {
  // bagId is irrelevant to timing; use a stable placeholder.
  return coinSoundCuesFromPlan(planCoinFx('bag-1', coinCount))
}

export function coinSoundCuesFromPlan(plan: CoinFxPlan): readonly CoinSoundCue[] {
  return plan.totalAtMs.map((atMs, index) => ({
    step: (index + 1) as 1 | 2 | 3,
    atMs,
  }))
}

/**
 * When `displayTotal` advances (null→1, 1→2, 2→3), return the step to chime.
 * Pure — does not play audio.
 */
export function soundStepForDisplayAdvance(
  previousDisplayTotal: number | null,
  displayTotal: number | null,
): 1 | 2 | 3 | null {
  if (displayTotal === null) return null
  if (displayTotal < 1 || displayTotal > 3) return null
  const prev = previousDisplayTotal ?? 0
  if (displayTotal === prev + 1) {
    return displayTotal as 1 | 2 | 3
  }
  return null
}

export type CoinChimeRequest =
  | { readonly play: true; readonly step: 1 | 2 | 3 }
  | { readonly play: false; readonly reason: 'sound-off' | 'no-step' }

/** Gate playback intent: SOUND OFF never requests play. */
export function resolveCoinChimeRequest(
  soundEnabled: boolean,
  previousDisplayTotal: number | null,
  displayTotal: number | null,
): CoinChimeRequest {
  const step = soundStepForDisplayAdvance(previousDisplayTotal, displayTotal)
  if (step === null) return { play: false, reason: 'no-step' }
  if (!soundEnabled) return { play: false, reason: 'sound-off' }
  return { play: true, step }
}
