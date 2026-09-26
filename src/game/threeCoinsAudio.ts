import { threeCoinsSrc } from './assets'
import { isSoundEnabled } from './sound'

/**
 * Playback volume (source file unchanged).
 * First draft — confirm cue; tunable after listening.
 */
export const THREE_COINS_VOLUME = 0.32

type ThreeCoinsAudioPool = {
  element: HTMLAudioElement | null
  unlocked: boolean
}

let pool: ThreeCoinsAudioPool | null = null

function getPool(): ThreeCoinsAudioPool | null {
  if (typeof Audio === 'undefined') return null
  if (pool) return pool
  try {
    const element = new Audio(threeCoinsSrc())
    element.preload = 'auto'
    element.volume = THREE_COINS_VOLUME
    pool = { element, unlocked: false }
    return pool
  } catch {
    return null
  }
}

/**
 * Ensure three-coins Audio exists after a user gesture.
 * No explicit load() — avoids aborting in-flight play (bag-open lesson).
 */
export function warmThreeCoinsAudio(): void {
  try {
    const p = getPool()
    if (!p || p.unlocked) return
    p.unlocked = true
  } catch {
    /* ignore — game must continue */
  }
}

/**
 * Play one 3 COINS confirm SE. Never throws; never touches ROUND state.
 * currentTime=0 + play() only — no sync load before play.
 */
export function playThreeCoins(options?: {
  soundEnabled?: boolean
  volume?: number
}): void {
  try {
    const enabled =
      options?.soundEnabled !== undefined
        ? options.soundEnabled
        : isSoundEnabled()
    if (!enabled) return

    const p = getPool()
    if (!p?.element) return

    const audio = p.element
    audio.volume = options?.volume ?? THREE_COINS_VOLUME
    try {
      audio.currentTime = 0
    } catch {
      /* some browsers throw if not loaded yet */
    }
    const result = audio.play()
    if (result && typeof result.catch === 'function') {
      void result.catch(() => {
        /* autoplay / decode errors — ignore */
      })
    }
  } catch {
    /* ignore — game must continue */
  }
}
