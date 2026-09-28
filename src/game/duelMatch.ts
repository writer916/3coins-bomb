import {
  isValidCompletedPlacement,
  type DuelRoundPlacement,
} from './duelPlacement'

/** Authorization resolves a private token to one of these roles outside this module. */
export type DuelParticipantId = 'A' | 'B'

export type DuelMatchState =
  | 'placement'
  | 'playable'
  | 'in-progress'
  | 'revealable'

/**
 * Result of one participant playing one ROUND against the opponent's placement.
 * Opening/game rules will produce this value in a later integration step.
 */
export type DuelRoundPlayResult = {
  readonly roundNumber: number
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly bombHit: boolean
  readonly openedBagCount: number
}

export type DuelParticipantInternalState = {
  readonly id: DuelParticipantId
  readonly placements: readonly DuelRoundPlacement[]
  readonly placementLocked: boolean
  /** Contiguous ROUND results, starting at ROUND 1. */
  readonly playResults: readonly DuelRoundPlayResult[]
}

/**
 * Server source of truth. Participant tokens intentionally do not belong here:
 * an authentication boundary maps a token to A/B before calling this domain.
 */
export type DuelMatchInternalState = {
  readonly matchId: string
  readonly totalRounds: number
  readonly participants: Readonly<
    Record<DuelParticipantId, DuelParticipantInternalState>
  >
}

export type DuelPlayProgressView = {
  readonly playedRounds: number
  readonly totalRounds: number
  readonly nextRoundNumber: number | null
  readonly completed: boolean
  readonly results: readonly DuelRoundPlayResult[]
}

export type DuelOpponentProgressView = Omit<DuelPlayProgressView, 'results'>

export type DuelSelfView = {
  readonly id: DuelParticipantId
  readonly placementLocked: boolean
  readonly placements: readonly DuelRoundPlacement[]
  readonly progress: DuelPlayProgressView
}

/** Deliberately has no placement or bag-content fields. */
export type DuelOpponentView = {
  readonly id: DuelParticipantId
  readonly placementLocked: boolean
  readonly progress: DuelOpponentProgressView
}

export type DuelParticipantView = {
  readonly matchId: string
  readonly viewer: DuelParticipantId
  readonly totalRounds: number
  readonly state: DuelMatchState
  readonly bothLocked: boolean
  readonly revealable: boolean
  readonly self: DuelSelfView
  readonly opponent: DuelOpponentView
}

export type DuelRevealParticipantView = {
  readonly id: DuelParticipantId
  readonly placements: readonly DuelRoundPlacement[]
  readonly progress: DuelPlayProgressView
}

export type DuelRevealView = {
  readonly matchId: string
  readonly totalRounds: number
  readonly state: 'revealable'
  readonly participants: Readonly<
    Record<DuelParticipantId, DuelRevealParticipantView>
  >
}

export type DuelDomainError =
  | 'invalid-match-id'
  | 'invalid-round-count'
  | 'placement-locked'
  | 'invalid-placements'
  | 'placements-incomplete'
  | 'match-not-playable'
  | 'participant-completed'
  | 'invalid-round-result'
  | 'reveal-not-allowed'

export type DuelTransitionResult<T> =
  | { readonly ok: true; readonly state: T }
  | { readonly ok: false; readonly reason: DuelDomainError; readonly state: T }

export type DuelRevealResult =
  | { readonly ok: true; readonly view: DuelRevealView }
  | { readonly ok: false; readonly reason: 'reveal-not-allowed' }

function otherParticipant(id: DuelParticipantId): DuelParticipantId {
  return id === 'A' ? 'B' : 'A'
}

function clonePlacement(p: DuelRoundPlacement): DuelRoundPlacement {
  return { ...p, coinCountsByBag: { ...p.coinCountsByBag } }
}

function cloneResult(r: DuelRoundPlayResult): DuelRoundPlayResult {
  return { ...r }
}

function validRoundCount(totalRounds: number): boolean {
  return Number.isInteger(totalRounds) && totalRounds >= 1 && totalRounds <= 20
}

function validPlacements(
  placements: readonly DuelRoundPlacement[],
  totalRounds: number,
): boolean {
  return (
    placements.length === totalRounds &&
    placements.every(
      (placement, index) =>
        placement.roundNumber === index + 1 &&
        isValidCompletedPlacement(placement),
    )
  )
}

function replaceParticipant(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
  participant: DuelParticipantInternalState,
): DuelMatchInternalState {
  return {
    ...match,
    participants: { ...match.participants, [id]: participant },
  }
}

export function createDuelMatch(
  matchId: string,
  totalRounds: number,
): DuelTransitionResult<DuelMatchInternalState> {
  const empty = (id: DuelParticipantId): DuelParticipantInternalState => ({
    id,
    placements: [],
    placementLocked: false,
    playResults: [],
  })
  const fallback: DuelMatchInternalState = {
    matchId,
    totalRounds,
    participants: { A: empty('A'), B: empty('B') },
  }

  if (matchId.trim().length === 0) {
    return { ok: false, reason: 'invalid-match-id', state: fallback }
  }
  if (!validRoundCount(totalRounds)) {
    return { ok: false, reason: 'invalid-round-count', state: fallback }
  }
  return { ok: true, state: fallback }
}

/** Replace all placements before LOCK; partial drafts stay outside this server domain. */
export function setParticipantPlacements(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
  placements: readonly DuelRoundPlacement[],
): DuelTransitionResult<DuelMatchInternalState> {
  const participant = match.participants[id]
  if (participant.placementLocked) {
    return { ok: false, reason: 'placement-locked', state: match }
  }
  if (!validPlacements(placements, match.totalRounds)) {
    return { ok: false, reason: 'invalid-placements', state: match }
  }
  const next = replaceParticipant(match, id, {
    ...participant,
    placements: placements.map(clonePlacement),
  })
  return { ok: true, state: next }
}

export function lockParticipantPlacements(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
): DuelTransitionResult<DuelMatchInternalState> {
  const participant = match.participants[id]
  if (participant.placementLocked) {
    return { ok: true, state: match }
  }
  if (!validPlacements(participant.placements, match.totalRounds)) {
    return { ok: false, reason: 'placements-incomplete', state: match }
  }
  return {
    ok: true,
    state: replaceParticipant(match, id, {
      ...participant,
      placementLocked: true,
    }),
  }
}

export function areBothPlacementsLocked(match: DuelMatchInternalState): boolean {
  return match.participants.A.placementLocked && match.participants.B.placementLocked
}

export function isParticipantCompleted(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
): boolean {
  return match.participants[id].playResults.length === match.totalRounds
}

export function isRevealable(match: DuelMatchInternalState): boolean {
  return isParticipantCompleted(match, 'A') && isParticipantCompleted(match, 'B')
}

export function deriveDuelMatchState(match: DuelMatchInternalState): DuelMatchState {
  if (isRevealable(match)) return 'revealable'
  if (!areBothPlacementsLocked(match)) return 'placement'
  const anyPlayed =
    match.participants.A.playResults.length > 0 ||
    match.participants.B.playResults.length > 0
  return anyPlayed ? 'in-progress' : 'playable'
}

function validPlayResult(
  result: DuelRoundPlayResult,
  expectedRound: number,
  opponentPlacement: DuelRoundPlacement,
): boolean {
  if (result.roundNumber !== expectedRound) return false
  if (!Number.isInteger(result.openedBagCount)) return false
  if (result.openedBagCount < 1 || result.openedBagCount > opponentPlacement.bagCount) {
    return false
  }
  if (result.bombHit && result.capturedCoins !== 0) return false
  return true
}

/** Record only the caller's next ROUND; the opponent's progress never gates it. */
export function recordParticipantRoundResult(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
  result: DuelRoundPlayResult,
): DuelTransitionResult<DuelMatchInternalState> {
  if (!areBothPlacementsLocked(match)) {
    return { ok: false, reason: 'match-not-playable', state: match }
  }
  const participant = match.participants[id]
  if (isParticipantCompleted(match, id)) {
    return { ok: false, reason: 'participant-completed', state: match }
  }
  const expectedRound = participant.playResults.length + 1
  const opponent = match.participants[otherParticipant(id)]
  const opponentPlacement = opponent.placements[expectedRound - 1]
  if (
    !opponentPlacement ||
    !validPlayResult(result, expectedRound, opponentPlacement)
  ) {
    return { ok: false, reason: 'invalid-round-result', state: match }
  }
  return {
    ok: true,
    state: replaceParticipant(match, id, {
      ...participant,
      playResults: [...participant.playResults, cloneResult(result)],
    }),
  }
}

function progressView(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
): DuelPlayProgressView {
  const results = match.participants[id].playResults.map(cloneResult)
  const completed = results.length === match.totalRounds
  return {
    playedRounds: results.length,
    totalRounds: match.totalRounds,
    nextRoundNumber: completed ? null : results.length + 1,
    completed,
    results,
  }
}

function opponentProgressView(
  match: DuelMatchInternalState,
  id: DuelParticipantId,
): DuelOpponentProgressView {
  const progress = progressView(match, id)
  return {
    playedRounds: progress.playedRounds,
    totalRounds: progress.totalRounds,
    nextRoundNumber: progress.nextRoundNumber,
    completed: progress.completed,
  }
}

export function toParticipantView(
  match: DuelMatchInternalState,
  viewer: DuelParticipantId,
): DuelParticipantView {
  const opponent = otherParticipant(viewer)
  const selfState = match.participants[viewer]
  const opponentState = match.participants[opponent]
  return {
    matchId: match.matchId,
    viewer,
    totalRounds: match.totalRounds,
    state: deriveDuelMatchState(match),
    bothLocked: areBothPlacementsLocked(match),
    revealable: isRevealable(match),
    self: {
      id: viewer,
      placementLocked: selfState.placementLocked,
      placements: selfState.placements.map(clonePlacement),
      progress: progressView(match, viewer),
    },
    opponent: {
      id: opponent,
      placementLocked: opponentState.placementLocked,
      progress: opponentProgressView(match, opponent),
    },
  }
}

export function toRevealView(match: DuelMatchInternalState): DuelRevealResult {
  if (!isRevealable(match)) {
    return { ok: false, reason: 'reveal-not-allowed' }
  }
  const revealParticipant = (id: DuelParticipantId): DuelRevealParticipantView => ({
    id,
    placements: match.participants[id].placements.map(clonePlacement),
    progress: progressView(match, id),
  })
  return {
    ok: true,
    view: {
      matchId: match.matchId,
      totalRounds: match.totalRounds,
      state: 'revealable',
      participants: { A: revealParticipant('A'), B: revealParticipant('B') },
    },
  }
}
