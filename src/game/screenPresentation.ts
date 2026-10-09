/**
 * Screen-local presentation lock: visual open FX + owned SFX must settle
 * before navigation (NEXT ROUND / RESULT / PLAY COMPLETE / TOP).
 *
 * Pure coordination — does not touch ROUND / match state.
 */

import { invalidatePendingMediaPlays } from './playMedia'

/** After visual ends, wait at most this long for owned SFX to settle. */
export const SCREEN_PRESENTATION_AUDIO_GRACE_MS = 2_500

type PresentationState = {
  generation: number
  visualActive: boolean
  pendingAudio: number
}

let state: PresentationState = {
  generation: 0,
  visualActive: false,
  pendingAudio: 0,
}

function isIdle(): boolean {
  return !state.visualActive && state.pendingAudio <= 0
}

/** True while an open FX visual is active or owned SFX is still settling. */
export function isScreenPresentationBlocking(): boolean {
  return !isIdle()
}

/**
 * Start a new presentation generation (one OPEN / FX run).
 * Invalidates any prior generation so late cues cannot keep the lock forever.
 */
export function beginScreenPresentation(): number {
  // A continuing OPEN may start after the previous visual ends while a short
  // owned audio tail is still playing. Supersede that tail before the new
  // generation so sounds cannot overlap and old promises cannot affect it.
  if (state.pendingAudio > 0) {
    invalidatePendingMediaPlays()
  }
  state = {
    generation: state.generation + 1,
    visualActive: true,
    pendingAudio: 0,
  }
  return state.generation
}

/** Register an owned SFX promise for the active generation. */
export function noteScreenPresentationAudio(
  generation: number,
  play: Promise<unknown> | void,
): void {
  if (generation !== state.generation) return
  if (!play || typeof (play as Promise<unknown>).then !== 'function') return
  state.pendingAudio += 1
  void Promise.resolve(play).finally(() => {
    if (generation !== state.generation) return
    state.pendingAudio = Math.max(0, state.pendingAudio - 1)
  })
}

/** Mark the visual portion finished (SFX may still be settling). */
export function markScreenPresentationVisualDone(generation: number): void {
  if (generation !== state.generation) return
  state.visualActive = false
}

/**
 * Drop the lock immediately (mismatch / unmount / reload recovery).
 * Also invalidates pending/late media so abandoned SFX cannot start after leave.
 */
export function abandonScreenPresentation(generation?: number): void {
  if (generation !== undefined && generation !== state.generation) return
  state = {
    generation: state.generation + 1,
    visualActive: false,
    pendingAudio: 0,
  }
  invalidatePendingMediaPlays()
}

/**
 * Resolve when this generation is idle, or after graceMs from call time.
 * Safe if generation was abandoned (resolves immediately).
 * On grace timeout (abnormal), invalidate pending media so late decode cannot audibly start.
 */
export function waitScreenPresentationSettled(
  generation: number,
  graceMs: number = SCREEN_PRESENTATION_AUDIO_GRACE_MS,
): Promise<void> {
  if (generation !== state.generation || isIdle()) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (generation !== state.generation || isIdle()) {
        resolve()
        return
      }
      if (Date.now() - started >= graceMs) {
        // Fail-open: never leave the player stuck if audio never ends.
        if (generation === state.generation) {
          // Bump generation so late FX cues cannot re-arm the lock or note SFX.
          state = {
            generation: state.generation + 1,
            visualActive: false,
            pendingAudio: 0,
          }
          // Abnormal path only — silence late/stuck plays before navigation unlocks.
          invalidatePendingMediaPlays()
        }
        resolve()
        return
      }
      setTimeout(tick, 32)
    }
    tick()
  })
}

/** Test helper — reset module state between verifies. */
export function __resetScreenPresentationForTests(): void {
  state = {
    generation: 0,
    visualActive: false,
    pendingAudio: 0,
  }
}
