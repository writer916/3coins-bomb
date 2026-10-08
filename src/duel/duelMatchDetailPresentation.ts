import type {
  DuelFinalResult,
  DuelMatchDetail,
  DuelMatchDetailRound,
  DuelPlayEndReason,
  DuelResultParticipantSummary,
} from './duelPlayClient'

type CompletedDuelResult = Extract<DuelFinalResult, { status: 'completed' }>
type ResultRound = DuelResultParticipantSummary['rounds'][number]

export interface DuelMatchDetailRoundView extends DuelMatchDetailRound {
  readonly endReason: DuelPlayEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
}

export interface DuelMatchDetailView {
  readonly matchId: string
  readonly totalRounds: number
  readonly yourRounds: readonly DuelMatchDetailRoundView[]
  readonly opponentRounds: readonly DuelMatchDetailRoundView[]
}

function joinRounds(
  detailRounds: DuelMatchDetail['yourPlay']['rounds'],
  resultRounds: DuelResultParticipantSummary['rounds'],
  totalRounds: number,
): readonly DuelMatchDetailRoundView[] {
  if (detailRounds.length !== totalRounds || resultRounds.length !== totalRounds) {
    throw new Error('DUEL match detail ROUND count mismatch.')
  }

  return detailRounds.map((detailRound, index) => {
    const resultRound: ResultRound | undefined = resultRounds[index]
    const expectedRound = index + 1
    if (
      !resultRound ||
      detailRound.roundNumber !== expectedRound ||
      resultRound.roundNumber !== expectedRound ||
      resultRound.openedBagCount !== detailRound.opens.length
    ) {
      throw new Error('DUEL match detail ROUND mismatch.')
    }
    return {
      ...detailRound,
      endReason: resultRound.endReason,
      capturedCoins: resultRound.capturedCoins,
      openedBagCount: resultRound.openedBagCount,
    }
  })
}

/** Joins completed RESULT summaries to viewer-perspective detail boards. */
export function buildDuelMatchDetailView(
  detail: DuelMatchDetail,
  result: CompletedDuelResult,
): DuelMatchDetailView {
  if (
    detail.matchId !== result.matchId ||
    detail.viewerRole !== result.viewerRole ||
    detail.totalRounds !== result.totalRounds
  ) {
    throw new Error('DUEL match detail does not match RESULT.')
  }

  const opponentRole = result.viewerRole === 'A' ? 'B' : 'A'
  const self = result.participants[result.viewerRole]
  const opponent = result.participants[opponentRole]
  if (self.role !== result.viewerRole || opponent.role !== opponentRole) {
    throw new Error('DUEL match detail participant mismatch.')
  }

  return {
    matchId: detail.matchId,
    totalRounds: detail.totalRounds,
    yourRounds: joinRounds(detail.yourPlay.rounds, self.rounds, detail.totalRounds),
    opponentRounds: joinRounds(
      detail.opponentPlay.rounds,
      opponent.rounds,
      detail.totalRounds,
    ),
  }
}
