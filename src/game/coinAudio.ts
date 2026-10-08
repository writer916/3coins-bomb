import { coinChimeSrc } from './assets'
import { warmBagOpenAudio } from './bagAudio'
import { playMediaElement, resolvedPlay } from './playMedia'
import { warmThreeCoinsAudio } from './threeCoinsAudio'
import { isSoundEnabled } from './sound'

/** Playback volume (source file unchanged). Tunable later after listening. */
export const COIN_CHIME_VOLUME = 0.32

const POOL_SIZE = 3

type AudioPool = {
  elements: HTMLAudioElement[]
  index: number
  unlocked: boolean
}

let pool: AudioPool | null = null

function getPool(): AudioPool | null {
  if (typeof Audio === 'undefined') return null
  if (pool) return pool
  try {
    const elements: HTMLAudioElement[] = []
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(coinChimeSrc())
      a.preload = 'auto'
      a.volume = COIN_CHIME_VOLUME
      elements.push(a)
    }
    pool = { elements, index: 0, unlocked: false }
    return pool
  } catch {
    return null
  }
}

/**
 * Warm / unlock audio after a user gesture (tap). Safe no-op on failure.
 * Required for mobile browsers that block autoplay.
 * Uses a silent probe — never plays the coin chime asset itself.
 */
export function unlockCoinAudio(): void {
  try {
    const p = getPool()
    if (!p || p.unlocked) return

    // Minimal silent wav — unlocks autoplay without sounding the chime.
    const silent = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
    )
    silent.volume = 0
    const result = silent.play()
    const warm = () => {
      p.unlocked = true
      for (const el of p.elements) {
        try {
          el.load()
        } catch {
          /* ignore */
        }
      }
      // Preload bag-open / three-coins off the open critical path (never sync load→play).
      warmBagOpenAudio()
      warmThreeCoinsAudio()
    }
    if (result && typeof result.then === 'function') {
      void result.then(warm).catch(() => {
        /* still mark warmed so later plays may succeed after gesture */
        p.unlocked = true
        warmBagOpenAudio()
        warmThreeCoinsAudio()
      })
    } else {
      warm()
    }
  } catch {
    /* ignore — game must continue */
  }
}

/**
 * Play one coin chime. Overlapping calls use a small Audio pool (no wait).
 * Never throws; never touches ROUND state.
 * Resolves when that pool element's playback ends / fails / times out.
 */
export function playCoinChime(options?: {
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
    if (!p) return resolvedPlay()

    const audio = p.elements[p.index % p.elements.length]
    p.index = (p.index + 1) % p.elements.length
    if (!audio) return resolvedPlay()

    return playMediaElement(audio, options?.volume ?? COIN_CHIME_VOLUME)
  } catch {
    return resolvedPlay()
  }
}

/** Test helper: run a play callback without letting errors escape. */
export function safeRunAudio(play: () => void): void {
  try {
    play()
  } catch {
    /* ignore */
  }
}
