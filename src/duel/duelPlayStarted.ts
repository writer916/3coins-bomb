/**
 * Whether the authenticated participant has opened at least one bag.
 * START click alone is not "started" — only server OPEN progress counts.
 */
import type { DuelPlayState } from './duelPlayClient'

export function duelPlayHasSelfOpenedBags(
  state: Pick<
    DuelPlayState,
    'activeRound' | 'latestTerminalRound' | 'selfProgress'
  >,
): boolean {
  if (state.selfProgress.completedRounds > 0) return true
  if (state.latestTerminalRound !== null) return true
  return (state.activeRound?.openedBags.length ?? 0) > 0
}
