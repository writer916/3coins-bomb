import {
  judgeGroupBag,
  type GroupOpenOutcome,
  type GroupRoundEndReason,
  type GroupRoundOpenInput,
  type GroupRoundPlacement,
} from './groupDomain.js'

export type GroupResultOpenKind = GroupOpenOutcome

export interface GroupResultDetailOpen {
  readonly order: number
  readonly kind: GroupResultOpenKind
  readonly coinCount: 0 | 1 | 2 | 3
}

export interface GroupResultDetailRound {
  readonly roundNumber: number
  readonly endReason: GroupRoundEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly opens: readonly GroupResultDetailOpen[]
}

/** Authoritative OPEN history for one ROUND — reveals opened bags only. */
export function revealGroupRoundOpens(
  placement: GroupRoundPlacement,
  opens: readonly GroupRoundOpenInput[],
): readonly GroupResultDetailOpen[] {
  return opens.map((opened) => {
    const judged = judgeGroupBag(placement, opened.bagNumber)
    return {
      order: opened.openOrder,
      kind: judged.outcome,
      coinCount: judged.coinsFound,
    }
  })
}
