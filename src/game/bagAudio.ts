import { bagOpenSrc } from './assets'
import { isSoundEnabled } from './sound'

/**
 * Playback volume (source file unchanged).
 * Tunable after listening — cloth open cue (mp3 itself not remastered).
 */
export const BAG_OPEN_VOLUME = 0.35

type BagAudioPool = {
  element: HTMLAudioElement | null
  unlocked: boolean
}

let pool: BagAudioPool | null = null

function getPool(): BagAudioPool | null {
  if (typeof Audio === 'undefined') return null
  if (pool) return pool
  try {
    const element = new Audio(bagOpenSrc())
    element.preload = 'auto'
    element.volume = BAG_OPEN_VOLUME
    pool = { element, unlocked: false }
    return pool
  } catch {
    return null
  }
}

/**
 * Ensure bag-open Audio exists after a user gesture (unlock / SOUND toggle).
 * Must NOT run load() while a play may be in flight — explicit load() aborts play().
 * Construction uses preload="auto"; no sync load→play on the open path.
 * Safe no-op on failure.
 */
export function warmBagOpenAudio(): void {
  try {
    const p = getPool()
    if (!p || p.unlocked) return
    p.unlocked = true
    // Intentionally no explicit MediaElement load — preload=auto only.
  } catch {
    /* ignore — game must continue */
  }
}

/**
 * Play one bag-open cloth SE. Never throws; never touches ROUND state.
 * Does not call load() — open path is currentTime=0 + play() only (like COIN).
 */
export function playBagOpen(options?: {
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
    audio.volume = options?.volume ?? BAG_OPEN_VOLUME
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
