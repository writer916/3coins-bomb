import type { AppStrings } from '../i18n'
import type { GroupResultDetailOpen, GroupResultDetailRound } from './groupPlayClient'

export function formatGroupHitRate(hits: number, opens: number): string {
  if (opens === 0) return '0%'
  const value = Math.round((hits / opens) * 1000) / 10
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

export function formatGroupRoundEndReason(
  endReason: GroupResultDetailRound['endReason'],
  t: AppStrings,
): string {
  if (endReason === 'cleared') return t.groupThreeCoinsComplete
  if (endReason === 'cashed_out') return t.groupRoundCashedOut
  if (endReason === 'bombed') return t.groupRoundBombed
  return t.groupRoundInterrupted
}

export function formatGroupOpenReveal(
  opened: GroupResultDetailOpen,
  t: AppStrings,
): string {
  if (opened.kind === 'empty') return t.resultEmpty
  if (opened.kind === 'bomb') return t.resultBomb
  return t.resultCoin(opened.coinCount)
}
