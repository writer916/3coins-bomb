import { playBagOpen } from './bagAudio'
import { resolveBagOpenSeRequest } from './bagSfx'
import {
  beginScreenPresentation,
  noteScreenPresentationAudio,
} from './screenPresentation'

/**
 * Begin a screen presentation generation and optionally play bag-open SE.
 * Returns the generation id to pass into open FX components.
 */
export function startOpenPresentation(soundEnabled: boolean): number {
  const generation = beginScreenPresentation()
  if (resolveBagOpenSeRequest(soundEnabled, true).play) {
    noteScreenPresentationAudio(
      generation,
      playBagOpen({ soundEnabled: true }),
    )
  }
  return generation
}
