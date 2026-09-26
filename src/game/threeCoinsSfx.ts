import type { CoinFxPlan } from './coinFx'

/** Delay after this open's last coin-chime cue before 3 COINS confirm SE. */
export const THREE_COINS_DELAY_AFTER_LAST_CHIME_MS = 200

/**
 * Elapsed ms of the last cumulative coin cue in this open's visual plan.
 * Source of truth — do not hardcode separate tempos.
 */
export function lastCoinCueAtMs(plan: CoinFxPlan): number {
  const last = plan.totalAtMs[plan.totalAtMs.length - 1]
  if (last === undefined) {
    throw new Error('lastCoinCueAtMs: empty totalAtMs')
  }
  return last
}

/** Absolute cue time for 3 COINS SE relative to this open's FX start. */
export function threeCoinsCueAtMs(plan: CoinFxPlan): number {
  return lastCoinCueAtMs(plan) + THREE_COINS_DELAY_AFTER_LAST_CHIME_MS
}

export type ThreeCoinsSeRequest =
  | { readonly play: true }
  | {
      readonly play: false
      readonly reason:
        | 'not-cleared'
        | 'sound-off'
        | 'too-early'
        | 'already-fired'
    }

/**
 * Gate 3 COINS confirm SE. Pure — does not play audio.
 * Cue is consumed once `elapsedMs >= cueAtMs` even when SOUND OFF,
 * so toggling ON mid-FX cannot fire a late cue.
 */
export function resolveThreeCoinsSeRequest(
  clearsRound: boolean,
  soundEnabled: boolean,
  alreadyFired: boolean,
  elapsedMs: number,
  cueAtMs: number,
): ThreeCoinsSeRequest {
  if (!clearsRound) return { play: false, reason: 'not-cleared' }
  if (alreadyFired) return { play: false, reason: 'already-fired' }
  if (elapsedMs < cueAtMs) return { play: false, reason: 'too-early' }
  if (!soundEnabled) return { play: false, reason: 'sound-off' }
  return { play: true }
}

export function shouldConsumeThreeCoinsCue(
  clearsRound: boolean,
  alreadyFired: boolean,
  elapsedMs: number,
  cueAtMs: number,
): boolean {
  return clearsRound && !alreadyFired && elapsedMs >= cueAtMs
}
