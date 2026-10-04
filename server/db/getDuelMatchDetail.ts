import { buildDuelMatchDetail, type PersistedDuelMatchDetail } from '../duel/duelMatchDetail.js'
import {
  loadDuelResultCompletionForParticipant,
  type GetDuelResultInput,
} from './getDuelResult.js'

export type GetDuelMatchDetailInput = GetDuelResultInput

/**
 * Completed-only match detail. Reuses RESULT completion SQL / both_completed gate.
 * Waiting or unauthorized → null (HTTP 404). Integrity failures throw.
 */
export async function getDuelMatchDetailForParticipant(
  input: GetDuelMatchDetailInput,
): Promise<PersistedDuelMatchDetail | null> {
  const snapshot = await loadDuelResultCompletionForParticipant(input)
  if (!snapshot || snapshot.kind !== 'completed') return null
  return buildDuelMatchDetail({
    matchId: snapshot.matchId,
    viewerRole: snapshot.viewerRole,
    totalRounds: snapshot.totalRounds,
    participants: snapshot.participants,
  })
}
