import {
  aggregateDuelParticipantResult,
  DuelResultDataError,
  pairDuelParticipantResults,
  type DuelParticipantResultInput,
  type DuelResultRole,
} from './duelResult.js'

export interface DuelMatchDetailOpen {
  readonly openOrder: number
  readonly bagNumber: number
}

export interface DuelMatchDetailRound {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly number[]
  readonly opens: readonly DuelMatchDetailOpen[]
}

export interface DuelMatchDetailPlay {
  readonly rounds: readonly DuelMatchDetailRound[]
}

/**
 * Viewer-perspective completed match detail.
 * yourPlay = opponent LOCK placements + viewer opens (what YOU explored).
 * opponentPlay = viewer LOCK placements + opponent opens (what THEY explored).
 */
export interface PersistedDuelMatchDetail {
  readonly matchId: string
  readonly status: 'completed'
  readonly viewerRole: DuelResultRole
  readonly totalRounds: number
  readonly yourPlay: DuelMatchDetailPlay
  readonly opponentPlay: DuelMatchDetailPlay
}

export interface BuildDuelMatchDetailInput {
  readonly matchId: string
  readonly viewerRole: DuelResultRole
  readonly totalRounds: number
  readonly participants: Readonly<
    Record<DuelResultRole, DuelParticipantResultInput>
  >
}

function fail(): never {
  throw new DuelResultDataError()
}

function opponentRoleOf(role: DuelResultRole): DuelResultRole {
  return role === 'A' ? 'B' : 'A'
}

function playFromExplorer(
  explorer: DuelParticipantResultInput,
  totalRounds: number,
): DuelMatchDetailPlay {
  if (
    explorer.totalRounds !== totalRounds ||
    explorer.opponentPlacements.length !== totalRounds ||
    explorer.rounds.length !== totalRounds
  ) {
    fail()
  }
  const rounds: DuelMatchDetailRound[] = []
  for (let index = 0; index < totalRounds; index += 1) {
    const placement = explorer.opponentPlacements[index]
    const settled = explorer.rounds[index]
    if (!placement || !settled) fail()
    if (
      placement.roundNumber !== index + 1 ||
      settled.roundNumber !== index + 1
    ) {
      fail()
    }
    rounds.push({
      roundNumber: placement.roundNumber,
      bagCount: placement.bagCount,
      bombBagNumber: placement.bombBagNumber,
      coinBagNumbers: placement.coinBagNumbers,
      opens: settled.opens.map((opened) => ({
        openOrder: opened.openOrder,
        bagNumber: opened.bagNumber,
      })),
    })
  }
  return { rounds }
}

/**
 * Validates both explorers with the same RESULT aggregate rules, then maps
 * viewer-perspective yourPlay / opponentPlay without changing scoring.
 */
export function buildDuelMatchDetail(
  input: BuildDuelMatchDetailInput,
): PersistedDuelMatchDetail {
  const { matchId, viewerRole, totalRounds, participants } = input
  if (viewerRole !== 'A' && viewerRole !== 'B') fail()
  if (!Number.isInteger(totalRounds) || totalRounds < 1 || totalRounds > 20) {
    fail()
  }
  const a = participants.A
  const b = participants.B
  if (!a || !b || a.role !== 'A' || b.role !== 'B') fail()

  // Same integrity gate as GET /result completed aggregation.
  pairDuelParticipantResults(
    aggregateDuelParticipantResult(a),
    aggregateDuelParticipantResult(b),
  )

  const opponentRole = opponentRoleOf(viewerRole)
  return {
    matchId,
    status: 'completed',
    viewerRole,
    totalRounds,
    yourPlay: playFromExplorer(participants[viewerRole], totalRounds),
    opponentPlay: playFromExplorer(participants[opponentRole], totalRounds),
  }
}
