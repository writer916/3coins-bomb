import {
  classifyDuelMatchUrlFragment,
  cleanDuelMatchFragment,
  ensureDuelPendingClaim,
  parseDuelInvitationUrl,
  parseDuelMatchRouteUrl,
  type HistoryAdapter,
  DuelInvitationUrlError,
} from './duelInvitation'
import {
  importDuelParticipantCapability,
  DuelParticipantCapabilityError,
} from './duelParticipantCapability'
import {
  completeParticipantBClaim,
  persistParticipantCapability,
  readParticipant,
  readPendingClaim,
  validateParticipant,
  type PendingClaimRecord,
  type StorageAdapter,
} from './duelPersistence'

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export class DuelClaimBootstrapError extends Error {
  constructor() {
    super('The DUEL invitation could not be completed.')
    this.name = 'DuelClaimBootstrapError'
  }
}

export interface DuelParticipantState {
  readonly matchId: string
  readonly totalRounds: number
  readonly role: 'A' | 'B'
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly self: {
    readonly claimed: true
    readonly placementLocked: boolean
  }
  readonly opponent: {
    readonly claimed: boolean
    readonly placementLocked: boolean
  }
}

export type DuelClaimBootstrapResult =
  | {
      readonly kind: 'participant-a'
      readonly matchId: string
      readonly state: DuelParticipantState
    }
  | {
      readonly kind: 'participant-b'
      readonly matchId: string
      readonly state: DuelParticipantState
    }

export interface DuelClaimBootstrapDependencies {
  readonly storage: StorageAdapter
  readonly history: HistoryAdapter
  readonly fetch: typeof fetch
  readonly crypto: Pick<Crypto, 'getRandomValues'>
}

function invalid(): never {
  throw new DuelClaimBootstrapError()
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    return invalid()
  }
}

function timestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalid()
  }
  return value
}

function positiveVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) return invalid()
  return value as number
}

function totalRounds(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
    return invalid()
  }
  return value as number
}

function parseClaimResponse(value: unknown, expectedMatchId: string): {
  readonly matchId: string
  readonly totalRounds: number
  readonly participantToken: string
} {
  const record = objectRecord(value)
  exactKeys(record, [
    'matchId',
    'totalRounds',
    'participant',
    'createdAt',
    'claimedAt',
    'expiresAt',
    'formationVersion',
    'ruleVersion',
  ])
  if (record.matchId !== expectedMatchId) return invalid()
  const participantRecord = objectRecord(record.participant)
  exactKeys(participantRecord, ['role', 'token'])
  if (participantRecord.role !== 'B') return invalid()
  let participant
  try {
    participant = validateParticipant({
      version: 1,
      matchId: expectedMatchId,
      role: 'B',
      token: participantRecord.token,
    })
  } catch {
    return invalid()
  }
  timestamp(record.createdAt)
  timestamp(record.claimedAt)
  timestamp(record.expiresAt, true)
  positiveVersion(record.formationVersion)
  positiveVersion(record.ruleVersion)
  return {
    matchId: expectedMatchId,
    totalRounds: totalRounds(record.totalRounds),
    participantToken: participant.token,
  }
}

function participantState(
  value: unknown,
  expectedMatchId: string,
  expectedRole: 'A' | 'B',
): DuelParticipantState {
  const record = objectRecord(value)
  exactKeys(record, [
    'matchId',
    'totalRounds',
    'role',
    'createdAt',
    'expiresAt',
    'formationVersion',
    'ruleVersion',
    'self',
    'opponent',
  ])
  if (record.matchId !== expectedMatchId || record.role !== expectedRole) {
    return invalid()
  }
  const self = objectRecord(record.self)
  const opponent = objectRecord(record.opponent)
  exactKeys(self, ['claimed', 'placementLocked'])
  exactKeys(opponent, ['claimed', 'placementLocked'])
  if (
    self.claimed !== true ||
    typeof self.placementLocked !== 'boolean' ||
    typeof opponent.claimed !== 'boolean' ||
    typeof opponent.placementLocked !== 'boolean'
  ) {
    return invalid()
  }
  return {
    matchId: expectedMatchId,
    totalRounds: totalRounds(record.totalRounds),
    role: expectedRole,
    createdAt: timestamp(record.createdAt) as string,
    expiresAt: timestamp(record.expiresAt, true),
    formationVersion: positiveVersion(record.formationVersion),
    ruleVersion: positiveVersion(record.ruleVersion),
    self: { claimed: true, placementLocked: self.placementLocked },
    opponent: {
      claimed: opponent.claimed,
      placementLocked: opponent.placementLocked,
    },
  }
}

async function tryGetParticipantState(
  matchId: string,
  participantToken: string,
  fetcher: typeof fetch,
  expectedRole: 'A' | 'B',
): Promise<DuelParticipantState | null> {
  try {
    const response = await fetcher(
      `/api/duel/matches/${encodeURIComponent(matchId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${participantToken}` },
      },
    )
    if (!response.ok) return null
    const body: unknown = await response.json()
    return participantState(body, matchId, expectedRole)
  } catch {
    return null
  }
}

async function getParticipantState(
  matchId: string,
  participantToken: string,
  fetcher: typeof fetch,
  expectedRole: 'A' | 'B' = 'B',
): Promise<DuelParticipantState> {
  const state = await tryGetParticipantState(
    matchId,
    participantToken,
    fetcher,
    expectedRole,
  )
  if (!state) return invalid()
  return state
}

/**
 * Claimed B re-entry (or response-lost recovery): pi1 already authenticates
 * via auth_token_hash. Persist then strip the invite fragment.
 */
async function importPromotedBFromInvite(
  matchId: string,
  invitationToken: string,
  cleanPath: string,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult | null> {
  const state = await tryGetParticipantState(
    matchId,
    invitationToken,
    dependencies.fetch,
    'B',
  )
  if (!state) return null
  const pending = readPendingClaim(dependencies.storage)
  if (
    pending?.matchId === matchId &&
    pending.invitationToken === invitationToken
  ) {
    completeParticipantBClaim(dependencies.storage, {
      matchId,
      participantToken: invitationToken,
    })
  } else {
    persistParticipantCapability(dependencies.storage, {
      matchId,
      role: 'B',
      token: invitationToken,
    })
  }
  const stored = readParticipant(dependencies.storage, matchId)
  if (
    !stored ||
    stored.role !== 'B' ||
    stored.token !== invitationToken ||
    stored.matchId !== matchId
  ) {
    return invalid()
  }
  try {
    cleanDuelMatchFragment(dependencies.history, cleanPath)
  } catch {
    return invalid()
  }
  return { kind: 'participant-b', matchId, state }
}

async function claimPending(
  pending: PendingClaimRecord,
  cleanPath: string,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult> {
  let response: Response
  try {
    response = await dependencies.fetch(
      `/api/duel/matches/${encodeURIComponent(pending.matchId)}/claim`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pending.invitationToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ claimRecoverySecret: pending.claimRecoverySecret }),
      },
    )
  } catch {
    return invalid()
  }
  if (!response.ok) return invalid()
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return invalid()
  }
  const claimed = parseClaimResponse(body, pending.matchId)
  completeParticipantBClaim(dependencies.storage, {
    matchId: claimed.matchId,
    participantToken: claimed.participantToken,
  })
  try {
    cleanDuelMatchFragment(dependencies.history, cleanPath)
  } catch {
    return invalid()
  }
  const state = await getParticipantState(
    claimed.matchId,
    claimed.participantToken,
    dependencies.fetch,
    'B',
  )
  if (state.totalRounds !== claimed.totalRounds) return invalid()
  return { kind: 'participant-b', matchId: claimed.matchId, state }
}

/**
 * Same `#invite=pi1` URL for first claim and post-claim re-entry.
 * Order: GET as durable B auth → else claim → else legacy LS B fallback.
 * Fragment is removed only after authenticated persist.
 */
async function bootstrapInvitationUrl(
  urlValue: string,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult> {
  let parsed
  try {
    parsed = parseDuelInvitationUrl(urlValue)
  } catch (error: unknown) {
    if (error instanceof DuelInvitationUrlError) return invalid()
    return invalid()
  }

  const imported = await importPromotedBFromInvite(
    parsed.matchId,
    parsed.invitationToken,
    parsed.cleanPath,
    dependencies,
  )
  if (imported) return imported

  try {
    const ensured = ensureDuelPendingClaim(
      parsed.matchId,
      parsed.invitationToken,
      dependencies.storage,
      dependencies.crypto,
    )
    return await claimPending(ensured.pending, parsed.cleanPath, dependencies)
  } catch (claimError: unknown) {
    const existing = readParticipant(dependencies.storage, parsed.matchId)
    if (existing?.role === 'B') {
      const state = await tryGetParticipantState(
        parsed.matchId,
        existing.token,
        dependencies.fetch,
        'B',
      )
      if (state) {
        try {
          cleanDuelMatchFragment(dependencies.history, parsed.cleanPath)
        } catch {
          return invalid()
        }
        return { kind: 'participant-b', matchId: parsed.matchId, state }
      }
    }
    if (claimError instanceof DuelClaimBootstrapError) throw claimError
    if (claimError instanceof DuelInvitationUrlError) return invalid()
    return invalid()
  }
}

async function executeBootstrap(
  urlValue: string,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult> {
  try {
    const route = parseDuelMatchRouteUrl(urlValue)
    if (route.hasFragment) {
      const fragmentKind = classifyDuelMatchUrlFragment(urlValue)
      if (fragmentKind === 'participant') {
        const imported = await importDuelParticipantCapability(urlValue, {
          storage: dependencies.storage,
          history: dependencies.history,
          fetch: dependencies.fetch,
        })
        return {
          kind: imported.kind,
          matchId: imported.matchId,
          state: {
            matchId: imported.matchId,
            totalRounds: imported.totalRounds,
            role: imported.kind === 'participant-a' ? 'A' : 'B',
            createdAt: imported.createdAt,
            expiresAt: imported.expiresAt,
            formationVersion: imported.formationVersion,
            ruleVersion: imported.ruleVersion,
            self: imported.self,
            opponent: imported.opponent,
          },
        }
      }
      if (fragmentKind !== 'invite') return invalid()
      return await bootstrapInvitationUrl(urlValue, dependencies)
    }

    const participant = readParticipant(dependencies.storage, route.matchId)
    if (participant?.role === 'A') {
      const state = await getParticipantState(
        route.matchId,
        participant.token,
        dependencies.fetch,
        'A',
      )
      return { kind: 'participant-a', matchId: route.matchId, state }
    }
    if (participant?.role === 'B') {
      const state = await getParticipantState(
        route.matchId,
        participant.token,
        dependencies.fetch,
        'B',
      )
      return { kind: 'participant-b', matchId: route.matchId, state }
    }
    const pending = readPendingClaim(dependencies.storage)
    if (!pending || pending.matchId !== route.matchId) return invalid()
    return await claimPending(pending, `/duel/${route.matchId}`, dependencies)
  } catch (error: unknown) {
    if (error instanceof DuelClaimBootstrapError) throw error
    if (error instanceof DuelParticipantCapabilityError) {
      throw new DuelClaimBootstrapError()
    }
    if (error instanceof DuelInvitationUrlError) {
      throw new DuelClaimBootstrapError()
    }
    throw new DuelClaimBootstrapError()
  }
}

/** Coalesces React StrictMode or other concurrent bootstrap attempts. */
export function createDuelClaimBootstrapCoordinator(
  dependencies: DuelClaimBootstrapDependencies,
): { run(urlValue: string): Promise<DuelClaimBootstrapResult> } {
  let inFlight: Promise<DuelClaimBootstrapResult> | null = null
  return {
    run(urlValue) {
      if (inFlight) return inFlight
      inFlight = executeBootstrap(urlValue, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
