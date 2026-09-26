import { bombPopSrc } from './assets'
import { isSoundEnabled } from './sound'

/**
 * Playback volume (source file unchanged).
 * First draft — slightly more presence than COIN 0.32; tunable after listening.
 */
export const BOMB_POP_VOLUME = 0.36

type BombAudioPool = {
  element: HTMLAudioElement | null
  unlocked: boolean
}

let pool: BombAudioPool | null = null

function getPool(): BombAudioPool | null {
  if (typeof Audio === 'undefined') return null
  if (pool) return pool
  try {
    const element = new Audio(bombPopSrc())
    element.preload = 'auto'
    element.volume = BOMB_POP_VOLUME
    pool = { element, unlocked: false }
    return pool
  } catch {
    return null
  }
}

/**
 * Warm the bomb audio element after a user gesture.
 * Prefer calling `unlockCoinAudio` for shared silent unlock;
 * this only loads the bomb asset so the first pop is ready.
 * Safe no-op on failure.
 */
export function warmBombAudio(): void {
  try {
    const p = getPool()
    if (!p || p.unlocked) return
    p.unlocked = true
    if (p.element) {
      try {
        p.element.load()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore — game must continue */
  }
}

/**
 * Play one BOMB pop. Never throws; never touches ROUND state.
 */
export function playBombPop(options?: {
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
    audio.volume = options?.volume ?? BOMB_POP_VOLUME
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
