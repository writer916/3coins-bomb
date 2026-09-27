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

/** 1 COIN reference duration — multi-sprite local motion reuses this feel. */
export const COIN_FX_ONE_TOTAL_MS = 720
/** 1 COIN spin step — multi-sprite local spin reuses this (not ×2/×3 plan steps). */
export const COIN_FX_ONE_SPIN_STEP_MS = 70
/** Shared rise window (ms) used by sampleCoinFx and multi-sprite locals. */
export const COIN_FX_RISE_MS = 180
/** Fade starts at this fraction of the active local/plan total. */
export const COIN_FX_FADE_RATIO = 0.72
/**
 * Each sprite's local clock starts this many ms before its +N beat,
 * so the chime lands ~40ms into the rise (same relationship as 1 COIN).
 */
export const COIN_SPRITE_PRE_BEAT_MS = 40

export type CoinFxSpriteSample = {
  readonly index: number
  /** False before start / after local fade-out / when parent FX finished. */
  readonly visible: boolean
  readonly offsetXPx: number
  readonly offsetYPx: number
  readonly motionT: number
  readonly spinFrame: CoinId
}

type SpriteOffset = { readonly x: number; readonly y: number }

/** Minimal fan-out so N coins read as N without loud scatter. */
export function coinSpriteOffsets(coinCount: FxCoinCount): readonly SpriteOffset[] {
  if (coinCount === 1) return [{ x: 0, y: 0 }]
  if (coinCount === 2) return [{ x: -9, y: 0 }, { x: 9, y: 1 }]
  return [
    { x: 0, y: -2 },
    { x: -11, y: 2 },
    { x: 11, y: 2 },
  ]
}

/** Local start ms for sprite `index` (aligned to cumulative beat − pre-beat). */
export function coinSpriteStartMs(plan: CoinFxPlan, index: number): number {
  const beat = plan.totalAtMs[index]
  if (beat === undefined) return 0
  return Math.max(0, beat - COIN_SPRITE_PRE_BEAT_MS)
}

/**
 * Local lifetime for one sprite: prefer 1 COIN's 720ms, never past plan.totalMs.
 * Floored to rise window so a late sprite can still complete a rise.
 */
export function coinSpriteLocalTotalMs(plan: CoinFxPlan, startMs: number): number {
  const remaining = plan.totalMs - startMs
  if (remaining <= 0) return 0
  return Math.max(
    COIN_FX_RISE_MS,
    Math.min(COIN_FX_ONE_TOTAL_MS, remaining),
  )
}

/** Rise / hold / fade progress for a local clock (same shape as 1 COIN). */
export function coinMotionTForLocal(
  localElapsedMs: number,
  localTotalMs: number,
): number {
  if (localTotalMs <= 0 || localElapsedMs < 0) return 0
  if (localElapsedMs >= localTotalMs) return 0
  const fadeStart = localTotalMs * COIN_FX_FADE_RATIO
  let motionT: number
  if (localElapsedMs < COIN_FX_RISE_MS) {
    motionT = localElapsedMs / COIN_FX_RISE_MS
  } else if (localElapsedMs < fadeStart) {
    motionT = 1
  } else {
    motionT = 1 - (localElapsedMs - fadeStart) / (localTotalMs - fadeStart)
  }
  return Math.max(0, Math.min(1, motionT))
}

/**
 * Per-sprite visual samples for multi-coin open FX.
 * - coinCount 1: single sprite matching `sampleCoinFx` motion/spin (offset 0).
 * - coinCount 2|3: staggered locals reusing 1 COIN rise+spin feel; parent totalMs unchanged.
 * Completion SoT remains `plan.totalMs` via `sampleCoinFx` — not per-sprite ends.
 */
export function sampleCoinSprites(
  plan: CoinFxPlan,
  elapsedMs: number,
): readonly CoinFxSpriteSample[] {
  const offsets = coinSpriteOffsets(plan.coinCount)

  if (elapsedMs < 0 || elapsedMs >= plan.totalMs) {
    return offsets.map((off, index) => ({
      index,
      visible: false,
      offsetXPx: off.x,
      offsetYPx: off.y,
      motionT: 0,
      spinFrame: 'coin-1' as CoinId,
    }))
  }

  // 1 COIN: mirror aggregate sample exactly (no stagger / no alternate spin step).
  if (plan.coinCount === 1) {
    const s = sampleCoinFx(plan, elapsedMs)
    const off = offsets[0]!
    return [
      {
        index: 0,
        visible: !s.finished,
        offsetXPx: off.x,
        offsetYPx: off.y,
        motionT: s.motionT,
        spinFrame: s.spinFrame,
      },
    ]
  }

  const out: CoinFxSpriteSample[] = []
  for (let i = 0; i < plan.coinCount; i++) {
    const off = offsets[i]!
    const startMs = coinSpriteStartMs(plan, i)
    const localTotal = coinSpriteLocalTotalMs(plan, startMs)
    const localElapsed = elapsedMs - startMs
    if (localElapsed < 0 || localTotal <= 0) {
      out.push({
        index: i,
        visible: false,
        offsetXPx: off.x,
        offsetYPx: off.y,
        motionT: 0,
        spinFrame: 'coin-1',
      })
      continue
    }
    const motionT = coinMotionTForLocal(localElapsed, localTotal)
    // Slight phase offset so stacked spins don't read as one ghosted coin.
    const phase = i * (COIN_FX_ONE_SPIN_STEP_MS / 2)
    const spinIndex =
      Math.floor((localElapsed + phase) / COIN_FX_ONE_SPIN_STEP_MS) %
      COIN_SPIN_CYCLE.length
    out.push({
      index: i,
      visible: motionT > 0.02,
      offsetXPx: off.x,
      offsetYPx: off.y,
      motionT,
      spinFrame: COIN_SPIN_CYCLE[spinIndex]!,
    })
  }
  return out
}
