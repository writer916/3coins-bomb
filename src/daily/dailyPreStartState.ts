import type { DailyParticipantView } from './dailyParticipantClient'

export type RestoredDailyEntryState = 'playing' | 'completed'

export function dailyEntryStateFromParticipant(
  view: Pick<DailyParticipantView, 'completedAt'>,
): RestoredDailyEntryState {
  return view.completedAt ? 'completed' : 'playing'
}
