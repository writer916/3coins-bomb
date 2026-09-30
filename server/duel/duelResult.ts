export type DuelResultRole = 'A' | 'B'
export type DuelResultEndReason = 'bombed' | 'cashed_out' | 'cleared'
export type DuelResultWinner = DuelResultRole | 'draw'

export interface DuelResultPlacementInput {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly number[]
}

export interface DuelResultOpenInput {
  readonly openOrder: number
  readonly bagNumber: number
}

export interface DuelResultRoundInput {
  readonly roundNumber: number
  readonly placementRole: DuelResultRole
  readonly endReason: DuelResultEndReason
  readonly capturedCoins: number
  readonly bombHit: boolean
  readonly openedBagCount: number
  readonly opens: readonly DuelResultOpenInput[]
}

export interface DuelParticipantResultInput {
  readonly role: DuelResultRole
  readonly totalRounds: number
  readonly opponentPlacements: readonly DuelResultPlacementInput[]
  readonly rounds: readonly DuelResultRoundInput[]
}

export interface DuelResultRoundSummary {
  readonly roundNumber: number
  readonly endReason: DuelResultEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
}

export interface DuelParticipantResultSummary {
  readonly role: DuelResultRole
  readonly totalCapturedCoins: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly hitRate: {
    readonly numerator: number
    readonly denominator: number
  }
  readonly rounds: readonly DuelResultRoundSummary[]
}

export class DuelResultDataError extends Error {
  constructor() {
    super('The DUEL result data is inconsistent.')
    this.name = 'DuelResultDataError'
  }
}

function fail(): never {
  throw new DuelResultDataError()
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) return fail()
  return value
}

function validatePlacement(
  placement: DuelResultPlacementInput,
  expectedRound: number,
): void {
  if (placement.roundNumber !== expectedRound) fail()
  const bagCount = integer(placement.bagCount, 3, 8)
  integer(placement.bombBagNumber, 1, bagCount)
  if (placement.coinBagNumbers.length !== 3) fail()
  let previous = 0
  for (const bagNumber of placement.coinBagNumbers) {
    integer(bagNumber, 1, bagCount)
    if (bagNumber === placement.bombBagNumber || bagNumber < previous) fail()
    previous = bagNumber
  }
}

/** Derives authoritative per-participant totals from results, opens and opponent placements. */
export function aggregateDuelParticipantResult(
  input: DuelParticipantResultInput,
): DuelParticipantResultSummary {
  const totalRounds = integer(input.totalRounds, 1, 20)
  if (
    input.opponentPlacements.length !== totalRounds ||
    input.rounds.length !== totalRounds
  ) fail()

  let totalCapturedCoins = 0
  let coinBagHits = 0
  let totalOpens = 0
  const rounds: DuelResultRoundSummary[] = []
  const opponentRole: DuelResultRole = input.role === 'A' ? 'B' : 'A'

  for (let index = 0; index < totalRounds; index += 1) {
    const expectedRound = index + 1
    const placement = input.opponentPlacements[index]
    const round = input.rounds[index]
    if (!placement || !round) fail()
    validatePlacement(placement, expectedRound)
    if (
      round.roundNumber !== expectedRound ||
      round.placementRole !== opponentRole ||
      round.opens.length !== round.openedBagCount
    ) fail()
    integer(round.openedBagCount, 1, placement.bagCount)

    let foundCoins = 0
    let openedBomb = false
    const openedBagNumbers = new Set<number>()
    for (let openIndex = 0; openIndex < round.opens.length; openIndex += 1) {
      const opened = round.opens[openIndex]
      if (!opened || opened.openOrder !== openIndex + 1) fail()
      integer(opened.bagNumber, 1, placement.bagCount)
      if (openedBagNumbers.has(opened.bagNumber)) fail()
      openedBagNumbers.add(opened.bagNumber)

      if (opened.bagNumber === placement.bombBagNumber) {
        openedBomb = true
      } else {
        const coinsInBag = placement.coinBagNumbers.filter(
          (bagNumber) => bagNumber === opened.bagNumber,
        ).length
        foundCoins += coinsInBag
        // One opened coin-bearing bag is exactly one hit, regardless of 1/2/3 coins.
        if (coinsInBag > 0) coinBagHits += 1
      }
      if (openIndex < round.opens.length - 1 && (openedBomb || foundCoins >= 3)) {
        fail()
      }
    }

    const terminalOpen = round.opens[round.opens.length - 1]
    if (round.endReason === 'bombed') {
      if (
        !round.bombHit || !openedBomb ||
        terminalOpen?.bagNumber !== placement.bombBagNumber ||
        round.capturedCoins !== 0 || foundCoins > 2
      ) fail()
    } else if (round.endReason === 'cleared') {
      if (round.bombHit || openedBomb || foundCoins !== 3 || round.capturedCoins !== 3) {
        fail()
      }
    } else if (round.endReason === 'cashed_out') {
      if (
        round.bombHit || openedBomb ||
        (round.capturedCoins !== 1 && round.capturedCoins !== 2) ||
        foundCoins !== round.capturedCoins
      ) fail()
    } else {
      fail()
    }

    totalCapturedCoins += integer(round.capturedCoins, 0, 3)
    totalOpens += round.openedBagCount
    rounds.push({
      roundNumber: expectedRound,
      endReason: round.endReason,
      capturedCoins: round.capturedCoins as 0 | 1 | 2 | 3,
      openedBagCount: round.openedBagCount,
    })
  }

  if (totalOpens <= 0 || coinBagHits > totalOpens) fail()
  return {
    role: input.role,
    totalCapturedCoins,
    coinBagHits,
    totalOpens,
    hitRate: { numerator: coinBagHits, denominator: totalOpens },
    rounds,
  }
}

function validateSummary(summary: DuelParticipantResultSummary): void {
  integer(summary.totalCapturedCoins, 0, 60)
  integer(summary.coinBagHits, 0, 160)
  integer(summary.totalOpens, 1, 160)
  if (
    summary.coinBagHits > summary.totalOpens ||
    summary.hitRate.numerator !== summary.coinBagHits ||
    summary.hitRate.denominator !== summary.totalOpens
  ) fail()
}

/** TOTAL COINS, then exact COIN-BAG HIT RATE cross-products, otherwise DRAW. */
export function compareDuelParticipantResults(
  a: DuelParticipantResultSummary,
  b: DuelParticipantResultSummary,
): DuelResultWinner {
  if (a.role !== 'A' || b.role !== 'B') fail()
  validateSummary(a)
  validateSummary(b)
  if (a.totalCapturedCoins !== b.totalCapturedCoins) {
    return a.totalCapturedCoins > b.totalCapturedCoins ? 'A' : 'B'
  }
  const aRateProduct = a.coinBagHits * b.totalOpens
  const bRateProduct = b.coinBagHits * a.totalOpens
  if (aRateProduct === bRateProduct) return 'draw'
  return aRateProduct > bRateProduct ? 'A' : 'B'
}
