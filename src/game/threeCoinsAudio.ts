import { threeCoinsSrc } from './assets'
import { playMediaElement, resolvedPlay } from './playMedia'
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
 * Resolves when playback ends / fails / times out (for presentation settle).
 */
export function playThreeCoins(options?: {
  soundEnabled?: boolean
  volume?: number
}): Promise<void> {
  try {
    const enabled =
      options?.soundEnabled !== undefined
        ? options.soundEnabled
        : isSoundEnabled()
    if (!enabled) return resolvedPlay()

    const p = getPool()
    if (!p?.element) return resolvedPlay()

    return playMediaElement(p.element, options?.volume ?? THREE_COINS_VOLUME)
  } catch {
    return resolvedPlay()
  }
}
