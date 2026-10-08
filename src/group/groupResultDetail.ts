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
  readonly bagNumber: number
  readonly kind: GroupResultOpenKind
  readonly coinCount: 0 | 1 | 2 | 3
}

export interface GroupResultDetailRound {
  readonly roundNumber: number
  readonly endReason: GroupRoundEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
  readonly opens: readonly GroupResultDetailOpen[]
}

/**
 * Closed-GROUP detail OPEN history: outcome plus bagNumber for board markers.
 * Only assembled after match status is closed (caller responsibility).
 */
export function revealGroupRoundOpens(
  placement: GroupRoundPlacement,
  opens: readonly GroupRoundOpenInput[],
): readonly GroupResultDetailOpen[] {
  return opens.map((opened) => {
    const judged = judgeGroupBag(placement, opened.bagNumber)
    return {
      order: opened.openOrder,
      bagNumber: opened.bagNumber,
      kind: judged.outcome,
      coinCount: judged.coinsFound,
    }
  })
}
