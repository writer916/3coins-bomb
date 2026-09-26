/**
 * Bag-open SE intent (pure).
 * Fired only by the UI after an accepted bag open — not by FX timelines.
 */

export type BagOpenSeRequest =
  | { readonly play: true }
  | {
      readonly play: false
      readonly reason: 'sound-off' | 'not-accepted'
    }

/**
 * Gate bag-open SE. Pure — does not play audio.
 * `accepted` must be true only for a successful unopened-bag open.
 */
export function resolveBagOpenSeRequest(
  soundEnabled: boolean,
  accepted: boolean,
): BagOpenSeRequest {
  if (!accepted) return { play: false, reason: 'not-accepted' }
  if (!soundEnabled) return { play: false, reason: 'sound-off' }
  return { play: true }
}
