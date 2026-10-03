/**
 * Best-effort preload + decode for bag-1…bag-8 webp assets.
 * Shared by SOLO and DUEL via BagBoard. Never fatal — failures are ignored.
 */
import { BAG_IDS, bagSrc, type BagId } from './assets'

/** Soft board-visibility wait; never block ROUND/PLAY for longer than this. */
export const BAG_IMAGE_PREP_TIMEOUT_MS = 280

let prepPromise: Promise<void> | null = null

function loadAndDecode(src: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    try {
      const img = new Image()
      const afterLoad = () => {
        if (typeof img.decode === 'function') {
          void img.decode().then(finish, finish)
        } else {
          finish()
        }
      }
      img.onload = afterLoad
      img.onerror = finish
      img.src = src
      if (img.complete) afterLoad()
    } catch {
      finish()
    }
  })
}

/**
 * Preload and decode all bag assets once. Concurrent callers share one Promise.
 * Resolves even when some images fail.
 */
export function prepareBagImages(
  bagIds: readonly BagId[] = BAG_IDS,
): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()

  // Full set uses the shared singleton; subsets still kick the full prep so
  // one early call warms every bag the app may show.
  if (bagIds === BAG_IDS || bagIds.length === BAG_IDS.length) {
    prepPromise ??= Promise.all(BAG_IDS.map((id) => loadAndDecode(bagSrc(id)))).then(
      () => undefined,
      () => undefined,
    )
    return prepPromise
  }

  return Promise.all(bagIds.map((id) => loadAndDecode(bagSrc(id)))).then(
    () => undefined,
    () => undefined,
  )
}

/** Test-only: clear singleton so verifies can re-run prep. */
export function resetBagImagePrepForTests(): void {
  prepPromise = null
}

/** URLs that prepareBagImages(BAG_IDS) warms. */
export function bagImagePrepSources(
  bagIds: readonly BagId[] = BAG_IDS,
): readonly string[] {
  return bagIds.map((id) => bagSrc(id))
}
