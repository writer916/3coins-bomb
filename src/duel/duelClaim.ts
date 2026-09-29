import {
  parseDuelMatchRouteUrl,
  prepareDuelInvitationEntry,
  type HistoryAdapter,
} from './duelInvitation'
import {
  completeParticipantBClaim,
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
  readonly role: 'B'
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

function participantState(value: unknown, expectedMatchId: string): DuelParticipantState {
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
  if (record.matchId !== expectedMatchId || record.role !== 'B') return invalid()
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
    role: 'B',
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

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) return invalid()
  try {
    return await response.json()
  } catch {
    return invalid()
  }
}

async function getParticipantState(
  matchId: string,
  participantToken: string,
  fetcher: typeof fetch,
): Promise<DuelParticipantState> {
  const response = await fetcher(`/api/duel/matches/${encodeURIComponent(matchId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${participantToken}` },
  })
  return participantState(await responseJson(response), matchId)
}

async function claimPending(
  pending: PendingClaimRecord,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult> {
  const response = await dependencies.fetch(
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
  const claimed = parseClaimResponse(await responseJson(response), pending.matchId)
  completeParticipantBClaim(dependencies.storage, {
    matchId: claimed.matchId,
    participantToken: claimed.participantToken,
  })
  const state = await getParticipantState(
    claimed.matchId,
    claimed.participantToken,
    dependencies.fetch,
  )
  if (state.totalRounds !== claimed.totalRounds) return invalid()
  return { kind: 'participant-b', matchId: claimed.matchId, state }
}

async function executeBootstrap(
  urlValue: string,
  dependencies: DuelClaimBootstrapDependencies,
): Promise<DuelClaimBootstrapResult> {
  try {
    const route = parseDuelMatchRouteUrl(urlValue)
    if (route.hasFragment) {
      const entry = prepareDuelInvitationEntry(
        urlValue,
        dependencies.storage,
        dependencies.history,
        dependencies.crypto,
      )
      if (entry.kind === 'participant-a') {
        return { kind: 'participant-a', matchId: entry.matchId }
      }
      if (entry.kind === 'participant-b') {
        const state = await getParticipantState(
          entry.matchId,
          entry.participant.token,
          dependencies.fetch,
        )
        return { kind: 'participant-b', matchId: entry.matchId, state }
      }
      return await claimPending(entry.pending, dependencies)
    }

    const participant = readParticipant(dependencies.storage, route.matchId)
    if (participant?.role === 'A') {
      return { kind: 'participant-a', matchId: route.matchId }
    }
    if (participant?.role === 'B') {
      const state = await getParticipantState(
        route.matchId,
        participant.token,
        dependencies.fetch,
      )
      return { kind: 'participant-b', matchId: route.matchId, state }
    }
    const pending = readPendingClaim(dependencies.storage)
    if (!pending || pending.matchId !== route.matchId) return invalid()
    return await claimPending(pending, dependencies)
  } catch (error: unknown) {
    if (error instanceof DuelClaimBootstrapError) throw error
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
