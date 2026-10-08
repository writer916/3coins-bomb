/**
 * Shared HTMLAudioElement play → Promise settle helper.
 * Never throws. Resolves on ended / error / play rejection / safety timeout.
 *
 * Abnormal paths (presentation grace / abandon) call `invalidatePendingMediaPlays`
 * so late-decoding `play()` cannot start audible output after navigation.
 */

/** Per-play hard cap so a stuck media element cannot block navigation forever. */
export const PLAY_MEDIA_SAFETY_TIMEOUT_MS = 5_000

let mediaEpoch = 0
const trackedElements = new Set<HTMLAudioElement>()

function silenceElement(audio: HTMLAudioElement): void {
  try {
    audio.pause()
  } catch {
    /* ignore */
  }
  try {
    audio.currentTime = 0
  } catch {
    /* ignore */
  }
}

/**
 * Invalidate in-flight / pending media plays (abnormal path only).
 * Already-scheduled `play()` that starts after this is immediately silenced.
 * Does not run on the normal settle path (audio ends → navigate).
 */
export function invalidatePendingMediaPlays(): void {
  mediaEpoch += 1
  for (const audio of trackedElements) {
    silenceElement(audio)
  }
  trackedElements.clear()
}

/** Test helper. */
export function __resetPlayMediaForTests(): void {
  mediaEpoch = 0
  trackedElements.clear()
}

/** Current media epoch — exposed for verifies. */
export function getPlayMediaEpoch(): number {
  return mediaEpoch
}

/**
 * Reset + play `audio`, resolving when playback finishes or fails.
 * Callers must gate SOUND ON/OFF before invoking.
 */
export function playMediaElement(
  audio: HTMLAudioElement,
  volume: number,
  safetyTimeoutMs: number = PLAY_MEDIA_SAFETY_TIMEOUT_MS,
): Promise<void> {
  const epoch = mediaEpoch
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      trackedElements.delete(audio)
      try {
        audio.removeEventListener('ended', finish)
        audio.removeEventListener('error', finish)
      } catch {
        /* ignore */
      }
      clearTimeout(timer)
      resolve()
    }

    const timer = setTimeout(finish, Math.max(0, safetyTimeoutMs))

    if (epoch !== mediaEpoch) {
      finish()
      return
    }

    try {
      audio.volume = volume
    } catch {
      /* ignore */
    }
    try {
      audio.currentTime = 0
    } catch {
      /* some browsers throw if not loaded yet */
    }

    try {
      audio.addEventListener('ended', finish)
      audio.addEventListener('error', finish)
    } catch {
      finish()
      return
    }

    trackedElements.add(audio)

    try {
      const result = audio.play()
      if (result && typeof result.then === 'function') {
        void result.then(
          () => {
            // Decode/autoplay may resolve after abandon/grace — silence late starts.
            if (epoch !== mediaEpoch) {
              silenceElement(audio)
              finish()
            }
          },
          () => {
            finish()
          },
        )
      } else if (epoch !== mediaEpoch) {
        silenceElement(audio)
        finish()
      }
    } catch {
      finish()
    }
  })
}

/** Resolved promise helper for SOUND OFF / missing element paths. */
export function resolvedPlay(): Promise<void> {
  return Promise.resolve()
}
