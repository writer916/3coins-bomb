import type { BagId, CoinId } from './assets'

export type FxCoinCount = 1 | 2 | 3

/**
 * Cumulative label sequence for a COIN open.
 * Always +1 → +2 → +3 style — never repeated +1 pulses.
 */
export function cumulativeCoinTotals(
  coinCount: FxCoinCount,
): readonly number[] {
  const out: number[] = []
  for (let n = 1; n <= coinCount; n++) out.push(n)
  return out
}

/** Spin frames: face → intermediate → edge → intermediate → face … */
export const COIN_SPIN_CYCLE: readonly CoinId[] = [
  'coin-1',
  'coin-2',
  'coin-3',
  'coin-2',
]

export type CoinFxPlan = {
  readonly bagId: BagId
  readonly coinCount: FxCoinCount
  /** Full FX length (ms). */
  readonly totalMs: number
  /** Keep opened bag visible until this elapsed time (ms). */
  readonly bagHideMs: number
  /** Elapsed ms when each cumulative total first appears (length = coinCount). */
  readonly totalAtMs: readonly number[]
  /** Spin frame step length (ms). */
  readonly spinStepMs: number
}

/** Timings tuned for short cinematic beats (~0.7–1.2s). */
export function planCoinFx(bagId: BagId, coinCount: FxCoinCount): CoinFxPlan {
  if (coinCount === 1) {
    return {
      bagId,
      coinCount,
      totalMs: 720,
      bagHideMs: 140,
      totalAtMs: [40],
      spinStepMs: 70,
    }
  }

  if (coinCount === 2) {
    return {
      bagId,
      coinCount,
      totalMs: 960,
      bagHideMs: 140,
      totalAtMs: [40, 320],
      spinStepMs: 65,
    }
  }

  return {
    bagId,
    coinCount,
    totalMs: 1180,
    bagHideMs: 140,
    totalAtMs: [40, 300, 560],
    spinStepMs: 60,
  }
}

export type CoinFxSample = {
  readonly bagId: BagId
  readonly coinCount: FxCoinCount
  /** Current cumulative label; null before first beat / after finish. */
  readonly displayTotal: number | null
  /** Last total of the burst — slightly stronger in UI. */
  readonly emphasize: boolean
  readonly spinFrame: CoinId
  /** Whether the opened bag should already be hidden visually. */
  readonly bagHidden: boolean
  readonly finished: boolean
  /** 0–1 rise/fade progress for the floating coin (visual only). */
  readonly motionT: number
}

/**
 * Pure sample of COIN open FX at `elapsedMs`.
 * Does not touch ROUND state.
 */
export function sampleCoinFx(plan: CoinFxPlan, elapsedMs: number): CoinFxSample {
  if (elapsedMs < 0) {
    return {
      bagId: plan.bagId,
      coinCount: plan.coinCount,
      displayTotal: null,
      emphasize: false,
      spinFrame: 'coin-1',
      bagHidden: false,
      finished: false,
      motionT: 0,
    }
  }

  if (elapsedMs >= plan.totalMs) {
    return {
      bagId: plan.bagId,
      coinCount: plan.coinCount,
      displayTotal: null,
      emphasize: false,
      spinFrame: 'coin-1',
      bagHidden: true,
      finished: true,
      motionT: 1,
    }
  }

  let displayTotal: number | null = null
  for (let i = 0; i < plan.totalAtMs.length; i++) {
    if (elapsedMs >= plan.totalAtMs[i]!) {
      displayTotal = i + 1
    }
  }

  const emphasize =
    displayTotal === plan.coinCount &&
    elapsedMs >= (plan.totalAtMs[plan.coinCount - 1] ?? 0)

  const spinIndex = Math.floor(elapsedMs / plan.spinStepMs) % COIN_SPIN_CYCLE.length
  const spinFrame = COIN_SPIN_CYCLE[spinIndex]!

  const fadeStart = plan.totalMs * 0.72
  let motionT: number
  if (elapsedMs < 180) {
    motionT = elapsedMs / 180
  } else if (elapsedMs < fadeStart) {
    motionT = 1
  } else {
    motionT = 1 - (elapsedMs - fadeStart) / (plan.totalMs - fadeStart)
  }

  return {
    bagId: plan.bagId,
    coinCount: plan.coinCount,
    displayTotal,
    emphasize,
    spinFrame,
    bagHidden: elapsedMs >= plan.bagHideMs,
    finished: false,
    motionT: Math.max(0, Math.min(1, motionT)),
  }
}

/** Build visual hidden set: opened bags, minus FX bag still held briefly. */
export function visualHiddenBagIds(
  opened: ReadonlySet<BagId>,
  fx: CoinFxSample | null,
): ReadonlySet<BagId> {
  if (!fx || fx.bagHidden || fx.finished) return opened
  if (!opened.has(fx.bagId)) return opened
  const next = new Set(opened)
  next.delete(fx.bagId)
  return next
}
