import type { DuelFinalResult } from './duelPlayClient'
import {
  classifyDuelResumeState,
  duelResumeCompletionFromResult,
  type DuelResumeStateKind,
} from './duelResumeState'

/**
 * Presentation phase after GET /result during post-play RESULT flow.
 * `result-ready` means the completed payload may be shown only after explicit reveal.
 */
export type DuelResultPresentationPhase =
  | 'waiting-for-opponent-complete'
  | 'result-ready'
  | 'result'

/** Both locked is implied by a successful GET /result auth gate. */
function lockedMatchSnapshot(matchId: string) {
  return {
    matchId,
    self: { claimed: true, placementLocked: true },
    opponent: { claimed: true, placementLocked: true },
  }
}

export function resolveDuelResultPresentation(
  matchId: string,
  result: DuelFinalResult,
  revealed: boolean,
): DuelResultPresentationPhase {
  const completion = duelResumeCompletionFromResult(
    result.status === 'completed'
      ? { status: 'completed' }
      : {
          status: 'waiting',
          selfCompleted: result.selfCompleted,
          opponentCompleted: result.opponentCompleted,
        },
  )
  const resume = classifyDuelResumeState(
    lockedMatchSnapshot(matchId),
    completion,
  )
  const kind: DuelResumeStateKind = resume.kind
  if (kind === 'waiting-for-opponent-complete') {
    return 'waiting-for-opponent-complete'
  }
  if (kind === 'result-ready') {
    return revealed ? 'result' : 'result-ready'
  }
  throw new Error('Unexpected DUEL result presentation resume kind.')
}
