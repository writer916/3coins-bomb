/**
 * Open-FX completion helpers — rAF primary, wall-clock fallback secondary.
 * Pure; no DOM / React / ROUND state.
 */

/** Extra ms after plan.totalMs before forcing completion if rAF stalled. */
export const OPEN_FX_FALLBACK_MARGIN_MS = 100

/** Wall-clock delay for the completion fallback timer. */
export function openFxFallbackDelayMs(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs < 0) {
    return OPEN_FX_FALLBACK_MARGIN_MS
  }
  return totalMs + OPEN_FX_FALLBACK_MARGIN_MS
}

/**
 * Single-flight gate: first caller wins and marks `flag.current = true`.
 * Later callers get false (rAF finished first, or fallback already ran).
 */
export function claimOpenFxCompletion(flag: { current: boolean }): boolean {
  if (flag.current) return false
  flag.current = true
  return true
}
