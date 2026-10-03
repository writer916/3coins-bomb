/**
 * Pure DUEL resume-phase classification from authenticated server snapshots.
 * No network, storage, role, or token-kind branching — routing stays elsewhere.
 */

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DuelResumeStateKind =
  | 'placement'
  | 'waiting-for-opponent-lock'
  | 'play'
  | 'waiting-for-opponent-complete'
  | 'result-ready'

export type DuelResumeState =
  | { readonly kind: 'placement'; readonly matchId: string }
  | { readonly kind: 'waiting-for-opponent-lock'; readonly matchId: string }
  | { readonly kind: 'play'; readonly matchId: string }
  | { readonly kind: 'waiting-for-opponent-complete'; readonly matchId: string }
  | { readonly kind: 'result-ready'; readonly matchId: string }

/** Minimal GET /matches/:id participant view used for early resume gates. */
export interface DuelResumeMatchSnapshot {
  readonly matchId: string
  readonly self: {
    readonly claimed: boolean
    readonly placementLocked: boolean
  }
  readonly opponent: {
    readonly claimed: boolean
    readonly placementLocked: boolean
  }
}

/**
 * Completion flags after both participants are placement-locked.
 * Sourced from GET /play (self incomplete) and/or GET /result — never from
 * ROUND/open detail fields.
 */
export interface DuelResumeCompletionSnapshot {
  readonly selfCompleted: boolean
  readonly opponentCompleted: boolean
}

export class DuelResumeStateError extends Error {
  constructor() {
    super('The DUEL resume state could not be determined.')
    this.name = 'DuelResumeStateError'
  }
}

function invalid(): never {
  throw new DuelResumeStateError()
}

function booleanField(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid()
  return value
}

function matchIdField(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return invalid()
  return value.toLowerCase()
}

/** True when GET match alone cannot finish classification (need play/result). */
export function duelResumeNeedsCompletionSnapshot(
  match: DuelResumeMatchSnapshot,
): boolean {
  const normalized = normalizeMatchSnapshot(match)
  return (
    normalized.self.placementLocked && normalized.opponent.placementLocked
  )
}

/**
 * Build completion input from GET /play when the explorer is still incomplete.
 * Opponent completion is irrelevant for PLAY; leave it false.
 */
export function duelResumeCompletionFromPlayIncomplete(
  participantCompleted: boolean,
): DuelResumeCompletionSnapshot {
  if (participantCompleted !== false) return invalid()
  return { selfCompleted: false, opponentCompleted: false }
}

/** Build completion input from GET /result waiting|completed payload fields. */
export function duelResumeCompletionFromResult(input: {
  readonly status: 'waiting' | 'completed'
  readonly selfCompleted?: boolean
  readonly opponentCompleted?: boolean
}): DuelResumeCompletionSnapshot {
  if (input.status === 'completed') {
    return { selfCompleted: true, opponentCompleted: true }
  }
  if (input.status !== 'waiting') return invalid()
  if (
    typeof input.selfCompleted !== 'boolean' ||
    typeof input.opponentCompleted !== 'boolean'
  ) {
    return invalid()
  }
  return {
    selfCompleted: input.selfCompleted,
    opponentCompleted: input.opponentCompleted,
  }
}

export function normalizeMatchSnapshot(
  match: DuelResumeMatchSnapshot,
): DuelResumeMatchSnapshot {
  return {
    matchId: matchIdField(match.matchId),
    self: {
      claimed: booleanField(match.self?.claimed),
      placementLocked: booleanField(match.self?.placementLocked),
    },
    opponent: {
      claimed: booleanField(match.opponent?.claimed),
      placementLocked: booleanField(match.opponent?.placementLocked),
    },
  }
}

export function normalizeCompletionSnapshot(
  progress: DuelResumeCompletionSnapshot,
): DuelResumeCompletionSnapshot {
  return {
    selfCompleted: booleanField(progress.selfCompleted),
    opponentCompleted: booleanField(progress.opponentCompleted),
  }
}

/**
 * Parse a GET /matches/:id JSON body into a resume match snapshot.
 * Rejects malformed / wrong-match payloads instead of guessing a phase.
 */
export function readDuelResumeMatchSnapshot(
  value: unknown,
  expectedMatchId: string,
): DuelResumeMatchSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  const record = value as Record<string, unknown>
  const matchId = matchIdField(expectedMatchId)
  if (matchIdField(record.matchId) !== matchId) return invalid()
  return normalizeMatchSnapshot({
    matchId,
    self: {
      claimed: booleanField(
        typeof record.self === 'object' &&
          record.self !== null &&
          !Array.isArray(record.self)
          ? (record.self as Record<string, unknown>).claimed
          : undefined,
      ),
      placementLocked: booleanField(
        typeof record.self === 'object' &&
          record.self !== null &&
          !Array.isArray(record.self)
          ? (record.self as Record<string, unknown>).placementLocked
          : undefined,
      ),
    },
    opponent: {
      claimed: booleanField(
        typeof record.opponent === 'object' &&
          record.opponent !== null &&
          !Array.isArray(record.opponent)
          ? (record.opponent as Record<string, unknown>).claimed
          : undefined,
      ),
      placementLocked: booleanField(
        typeof record.opponent === 'object' &&
          record.opponent !== null &&
          !Array.isArray(record.opponent)
          ? (record.opponent as Record<string, unknown>).placementLocked
          : undefined,
      ),
    },
  })
}

/**
 * Classify resume phase.
 * - Unlocked self → placement (match only)
 * - Locked self / unlocked opponent → waiting-for-opponent-lock (match only)
 * - Both locked → requires completion snapshot (play and/or result)
 *
 * Does not inspect role, token kind, ROUND numbers, or opened bags.
 */
export function classifyDuelResumeState(
  match: DuelResumeMatchSnapshot,
  completion?: DuelResumeCompletionSnapshot,
): DuelResumeState {
  const normalized = normalizeMatchSnapshot(match)
  const matchId = normalized.matchId

  if (!normalized.self.placementLocked) {
    return { kind: 'placement', matchId }
  }
  if (!normalized.opponent.placementLocked) {
    return { kind: 'waiting-for-opponent-lock', matchId }
  }
  if (completion === undefined) return invalid()
  const progress = normalizeCompletionSnapshot(completion)

  if (!progress.selfCompleted) {
    return { kind: 'play', matchId }
  }
  if (!progress.opponentCompleted) {
    return { kind: 'waiting-for-opponent-complete', matchId }
  }
  return { kind: 'result-ready', matchId }
}
