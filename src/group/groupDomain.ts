export const GROUP_ROUNDS_MIN = 1
export const GROUP_ROUNDS_MAX = 20
export const GROUP_PLAYERS_MIN = 2
export const GROUP_PLAYERS_MAX = 20
export const GROUP_NICKNAME_MIN_GRAPHEMES = 1
export const GROUP_NICKNAME_MAX_GRAPHEMES = 20
export const GROUP_BAG_COUNT_MIN = 3
export const GROUP_BAG_COUNT_MAX = 8
export const GROUP_FORMATION_VERSION = 1
export const GROUP_RULE_VERSION = 1
export const GROUP_SCORING_VERSION = 1

export type GroupPlacementOrigin = 'generated' | 'duel-history'
export const GROUP_PLACEMENT_ORIGINS = [
  'generated',
  'duel-history',
] as const satisfies readonly GroupPlacementOrigin[]
export type GroupRoundEndReason =
  | 'bombed'
  | 'cashed_out'
  | 'cleared'
  | 'interrupted'

export type GroupOpenOutcome = 'empty' | 'coins' | 'bomb'

export interface GroupRoundPlacement {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

/**
 * Common input boundary for future PC-generated and DUEL-history providers.
 * Provenance never changes the placement rules used by GROUP play.
 */
export interface GroupPlacementCandidate {
  readonly origin: GroupPlacementOrigin
  readonly placement: GroupRoundPlacement
}

export interface GroupPlacementSet {
  readonly totalRounds: number
  readonly placements: readonly GroupPlacementCandidate[]
}

export interface GroupRoundOpenInput {
  readonly openOrder: number
  readonly bagNumber: number
}

export interface GroupRoundResultInput {
  readonly roundNumber: number
  readonly endReason: GroupRoundEndReason
  readonly capturedCoins: number
  readonly opens: readonly GroupRoundOpenInput[]
}

export interface GroupParticipantResultInput {
  readonly participantId: string
  readonly acceptedAt: string
  readonly totalRounds: number
  readonly placements: readonly GroupRoundPlacement[]
  readonly rounds: readonly GroupRoundResultInput[]
}

export interface GroupRoundResultSummary {
  readonly roundNumber: number
  readonly endReason: GroupRoundEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
}

export interface GroupParticipantResultSummary {
  readonly participantId: string
  readonly acceptedAt: string
  readonly totalCapturedCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly hitRate: {
    readonly numerator: number
    readonly denominator: number
  }
  readonly rounds: readonly GroupRoundResultSummary[]
}

export interface RankedGroupParticipant extends GroupParticipantResultSummary {
  readonly rank: number
}

export interface GroupLocalOpenResult {
  readonly outcome: GroupOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

export class GroupDomainValidationError extends Error {
  constructor() {
    super('The GROUP domain data is invalid.')
    this.name = 'GroupDomainValidationError'
  }
}

function invalid(): never {
  throw new GroupDomainValidationError()
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    return invalid()
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return invalid()
  }
  return value
}

export function validateGroupRounds(value: unknown): number {
  return integer(value, GROUP_ROUNDS_MIN, GROUP_ROUNDS_MAX)
}

export function validateGroupPlayers(value: unknown): number {
  return integer(value, GROUP_PLAYERS_MIN, GROUP_PLAYERS_MAX)
}

/** Full-capacity completion is the only automatic GROUP finalization path. */
export function canAutomaticallyFinalizeGroup(
  acceptedCountValue: unknown,
  completedCountValue: unknown,
  playerLimitValue: unknown,
): boolean {
  const playerLimit = validateGroupPlayers(playerLimitValue)
  const acceptedCount = integer(acceptedCountValue, 0, playerLimit)
  const completedCount = integer(completedCountValue, 0, acceptedCount)
  return acceptedCount === playerLimit && completedCount === playerLimit
}

const NICKNAME_CODE_POINTS = /^[\p{L}\p{M}\p{N}]+$/u
const NICKNAME_BASE_CODE_POINT = /[\p{L}\p{N}]/u
const FULLWIDTH_LATIN_OR_DIGIT = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/u
const nicknameSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })

function nicknameGraphemes(value: string): readonly string[] {
  return [...nicknameSegmenter.segment(value)].map(({ segment }) => segment)
}

/**
 * Validates a display nickname without rewriting it. Letters, combining marks
 * and numbers are accepted; whitespace, punctuation, symbols and emoji are not.
 * Fullwidth Latin letters/digits are explicitly rejected. Length is measured in
 * user-perceived grapheme clusters rather than UTF-16 code units.
 */
export function validateGroupNickname(value: unknown): string {
  if (typeof value !== 'string' || FULLWIDTH_LATIN_OR_DIGIT.test(value)) {
    return invalid()
  }
  const graphemes = nicknameGraphemes(value)
  if (
    graphemes.length < GROUP_NICKNAME_MIN_GRAPHEMES ||
    graphemes.length > GROUP_NICKNAME_MAX_GRAPHEMES
  ) {
    return invalid()
  }
  for (const grapheme of graphemes) {
    if (
      !NICKNAME_CODE_POINTS.test(grapheme) ||
      !NICKNAME_BASE_CODE_POINT.test(grapheme)
    ) {
      return invalid()
    }
  }
  return value
}

/**
 * Minimal duplicate key: canonical Unicode equivalents compare equal while
 * case and compatibility distinctions remain intact. The display value is
 * always the original validated input.
 */
export function createGroupNicknameKey(value: unknown): string {
  return validateGroupNickname(value).normalize('NFC')
}

export function validateGroupPlacement(
  value: unknown,
  expectedRoundNumber?: number,
): GroupRoundPlacement {
  const placement = record(value)
  exactKeys(placement, [
    'roundNumber',
    'bagCount',
    'bombBagNumber',
    'coinBagNumbers',
  ])
  const roundNumber = integer(placement.roundNumber, 1, GROUP_ROUNDS_MAX)
  if (expectedRoundNumber !== undefined && roundNumber !== expectedRoundNumber) {
    return invalid()
  }
  const bagCount = integer(
    placement.bagCount,
    GROUP_BAG_COUNT_MIN,
    GROUP_BAG_COUNT_MAX,
  )
  const bombBagNumber = integer(placement.bombBagNumber, 1, bagCount)
  if (
    !Array.isArray(placement.coinBagNumbers) ||
    placement.coinBagNumbers.length !== 3
  ) {
    return invalid()
  }
  const coins = placement.coinBagNumbers.map((coin) => integer(coin, 1, bagCount))
  if (
    coins.some((coin, index) => index > 0 && coin < coins[index - 1]!) ||
    coins.includes(bombBagNumber)
  ) {
    return invalid()
  }
  return {
    roundNumber,
    bagCount,
    bombBagNumber,
    coinBagNumbers: coins as [number, number, number],
  }
}

export function validateGroupPlacementCandidate(
  value: unknown,
  expectedRoundNumber?: number,
): GroupPlacementCandidate {
  const candidate = record(value)
  exactKeys(candidate, ['origin', 'placement'])
  if (
    candidate.origin !== 'generated' &&
    candidate.origin !== 'duel-history'
  ) {
    return invalid()
  }
  return {
    origin: candidate.origin,
    placement: validateGroupPlacement(candidate.placement, expectedRoundNumber),
  }
}

export function validateGroupPlacementSet(
  value: unknown,
): GroupPlacementSet {
  const set = record(value)
  exactKeys(set, ['totalRounds', 'placements'])
  const totalRounds = validateGroupRounds(set.totalRounds)
  if (!Array.isArray(set.placements) || set.placements.length !== totalRounds) {
    return invalid()
  }
  return {
    totalRounds,
    placements: set.placements.map((candidate, index) =>
      validateGroupPlacementCandidate(candidate, index + 1),
    ),
  }
}

export function judgeGroupBag(
  placementValue: unknown,
  bagNumberValue: number,
): GroupLocalOpenResult {
  const placement = validateGroupPlacement(placementValue)
  const bagNumber = integer(bagNumberValue, 1, placement.bagCount)
  if (bagNumber === placement.bombBagNumber) {
    return { outcome: 'bomb', coinsFound: 0 }
  }
  const coinsFound = placement.coinBagNumbers.filter(
    (coinBagNumber) => coinBagNumber === bagNumber,
  ).length
  if (coinsFound === 0) return { outcome: 'empty', coinsFound: 0 }
  return {
    outcome: 'coins',
    coinsFound: coinsFound as 1 | 2 | 3,
  }
}

function validateAcceptedAt(value: string): string {
  if (typeof value !== 'string') return invalid()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return invalid()
  }
  return value
}

function validateParticipantId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return invalid()
  return value
}

/** Reconstructs authoritative GROUP totals from placements and actual opens. */
export function aggregateGroupParticipantResult(
  input: GroupParticipantResultInput,
): GroupParticipantResultSummary {
  const participantId = validateParticipantId(input.participantId)
  const acceptedAt = validateAcceptedAt(input.acceptedAt)
  const totalRounds = validateGroupRounds(input.totalRounds)
  if (
    !Array.isArray(input.placements) ||
    !Array.isArray(input.rounds) ||
    input.placements.length !== totalRounds ||
    input.rounds.length !== totalRounds
  ) {
    return invalid()
  }

  let totalCapturedCoins = 0
  let threeCoinsComplete = 0
  let coinBagHits = 0
  let totalOpens = 0
  const rounds: GroupRoundResultSummary[] = []

  for (let index = 0; index < totalRounds; index += 1) {
    const expectedRound = index + 1
    const placementValue = input.placements[index]
    const round = input.rounds[index]
    if (!placementValue || !round || round.roundNumber !== expectedRound) {
      return invalid()
    }
    const placement = validateGroupPlacement(placementValue, expectedRound)
    if (
      !['bombed', 'cashed_out', 'cleared', 'interrupted'].includes(
        round.endReason,
      ) ||
      !Array.isArray(round.opens)
    ) {
      return invalid()
    }

    let foundCoins = 0
    let roundCoinBagHits = 0
    let openedBomb = false
    const openedBagNumbers = new Set<number>()
    for (let openIndex = 0; openIndex < round.opens.length; openIndex += 1) {
      const opened = round.opens[openIndex]
      if (!opened || opened.openOrder !== openIndex + 1) return invalid()
      const bagNumber = integer(opened.bagNumber, 1, placement.bagCount)
      if (openedBagNumbers.has(bagNumber)) return invalid()
      openedBagNumbers.add(bagNumber)
      const judged = judgeGroupBag(placement, bagNumber)
      if (judged.outcome === 'bomb') openedBomb = true
      if (judged.outcome === 'coins') {
        foundCoins += judged.coinsFound
        roundCoinBagHits += 1
      }
      if (
        openIndex < round.opens.length - 1 &&
        (openedBomb || foundCoins >= 3)
      ) {
        return invalid()
      }
    }

    const capturedCoins = integer(round.capturedCoins, 0, 3)
    const lastOpen = round.opens[round.opens.length - 1]
    if (round.endReason === 'bombed') {
      // BOMB forfeits every provisional coin; confirmed capturedCoins must be 0.
      // foundCoins (0–2) still drives COIN-BAG HIT RATE from the open history.
      if (
        !openedBomb ||
        lastOpen?.bagNumber !== placement.bombBagNumber ||
        capturedCoins !== 0 ||
        foundCoins >= 3
      ) {
        return invalid()
      }
    } else if (round.endReason === 'cleared') {
      if (openedBomb || foundCoins !== 3 || capturedCoins !== 3) {
        return invalid()
      }
    } else if (round.endReason === 'cashed_out') {
      if (
        openedBomb ||
        (capturedCoins !== 1 && capturedCoins !== 2) ||
        foundCoins !== capturedCoins
      ) {
        return invalid()
      }
    } else if (
      capturedCoins !== 0 ||
      openedBomb ||
      foundCoins >= 3
    ) {
      return invalid()
    }

    totalCapturedCoins += capturedCoins
    if (round.endReason === 'cleared') threeCoinsComplete += 1
    coinBagHits += roundCoinBagHits
    totalOpens += round.opens.length
    rounds.push({
      roundNumber: expectedRound,
      endReason: round.endReason,
      capturedCoins: capturedCoins as 0 | 1 | 2 | 3,
      openedBagCount: round.opens.length,
      coinBagHits: roundCoinBagHits,
    })
  }

  return {
    participantId,
    acceptedAt,
    totalCapturedCoins,
    threeCoinsComplete,
    coinBagHits,
    totalOpens,
    hitRate: { numerator: coinBagHits, denominator: totalOpens },
    rounds,
  }
}

function validateSummary(
  summary: GroupParticipantResultSummary,
): GroupParticipantResultSummary {
  validateParticipantId(summary.participantId)
  validateAcceptedAt(summary.acceptedAt)
  integer(summary.totalCapturedCoins, 0, GROUP_ROUNDS_MAX * 3)
  integer(summary.threeCoinsComplete, 0, GROUP_ROUNDS_MAX)
  integer(summary.coinBagHits, 0, GROUP_ROUNDS_MAX * GROUP_BAG_COUNT_MAX)
  integer(summary.totalOpens, 0, GROUP_ROUNDS_MAX * GROUP_BAG_COUNT_MAX)
  if (
    summary.coinBagHits > summary.totalOpens ||
    summary.threeCoinsComplete > summary.rounds.length ||
    summary.hitRate.numerator !== summary.coinBagHits ||
    summary.hitRate.denominator !== summary.totalOpens
  ) {
    return invalid()
  }
  return summary
}

function compareHitRate(
  a: GroupParticipantResultSummary,
  b: GroupParticipantResultSummary,
): number {
  // No opens contributes a zero rate. A denominator of 1 makes 0/0 compare
  // equal to every other zero rate while remaining below any positive rate.
  const aDenominator = a.totalOpens === 0 ? 1 : a.totalOpens
  const bDenominator = b.totalOpens === 0 ? 1 : b.totalOpens
  const aProduct = a.coinBagHits * bDenominator
  const bProduct = b.coinBagHits * aDenominator
  return aProduct === bProduct ? 0 : aProduct > bProduct ? -1 : 1
}

/** Score-only comparison. Negative means `a` ranks ahead of `b`. */
export function compareGroupParticipantScores(
  aValue: GroupParticipantResultSummary,
  bValue: GroupParticipantResultSummary,
): number {
  const a = validateSummary(aValue)
  const b = validateSummary(bValue)
  if (a.totalCapturedCoins !== b.totalCapturedCoins) {
    return b.totalCapturedCoins - a.totalCapturedCoins
  }
  if (a.threeCoinsComplete !== b.threeCoinsComplete) {
    return b.threeCoinsComplete - a.threeCoinsComplete
  }
  return compareHitRate(a, b)
}

function compareDisplayOrder(
  a: GroupParticipantResultSummary,
  b: GroupParticipantResultSummary,
): number {
  const scoreOrder = compareGroupParticipantScores(a, b)
  if (scoreOrder !== 0) return scoreOrder
  const acceptedOrder = Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt)
  if (acceptedOrder !== 0) return acceptedOrder
  return a.participantId < b.participantId
    ? -1
    : a.participantId > b.participantId ? 1 : 0
}

/** Competition ranking: equal scores produce ranks such as 1, 1, 3. */
export function rankGroupParticipants(
  values: readonly GroupParticipantResultSummary[],
): readonly RankedGroupParticipant[] {
  const sorted = values.map(validateSummary).sort(compareDisplayOrder)
  let previous: GroupParticipantResultSummary | null = null
  let previousRank = 0
  return sorted.map((participant, index) => {
    const rank =
      previous && compareGroupParticipantScores(previous, participant) === 0
        ? previousRank
        : index + 1
    previous = participant
    previousRank = rank
    return { ...participant, rank }
  })
}
