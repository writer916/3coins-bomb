import {
  parseDuelParticipantUrl,
  type HistoryAdapter,
} from './duelInvitation'
import {
  persistParticipantCapability,
  readParticipant,
  type DuelParticipantRecord,
  type StorageAdapter,
} from './duelPersistence'

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export class DuelParticipantCapabilityError extends Error {
  constructor() {
    super('The DUEL participant capability could not be imported.')
    this.name = 'DuelParticipantCapabilityError'
  }
}

export interface DuelParticipantCapabilityDependencies {
  readonly storage: StorageAdapter
  readonly history: HistoryAdapter
  readonly fetch: typeof fetch
}

export type DuelParticipantCapabilityImportResult =
  | {
      readonly kind: 'participant-a'
      readonly matchId: string
      readonly participant: DuelParticipantRecord
      readonly totalRounds: number
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
  | {
      readonly kind: 'participant-b'
      readonly matchId: string
      readonly participant: DuelParticipantRecord
      readonly totalRounds: number
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

function invalid(): never {
  throw new DuelParticipantCapabilityError()
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

function parseAuthenticatedMatch(
  value: unknown,
  expectedMatchId: string,
  expectedRole: 'A' | 'B',
): {
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
} {
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
  if (record.matchId !== expectedMatchId) return invalid()
  if (record.role !== expectedRole) return invalid()
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

function cleanPathAfterPersist(
  history: HistoryAdapter,
  cleanPath: string,
): void {
  try {
    history.replaceState(null, '', cleanPath)
  } catch {
    return invalid()
  }
}

/**
 * Imports a durable `#p=` participant capability into local storage only after
 * the token authenticates against GET /api/duel/matches/:id. Fragment is
 * removed only after a successful verified write.
 */
export async function importDuelParticipantCapability(
  urlValue: string,
  dependencies: DuelParticipantCapabilityDependencies,
): Promise<DuelParticipantCapabilityImportResult> {
  let parsed
  try {
    parsed = parseDuelParticipantUrl(urlValue)
  } catch {
    return invalid()
  }

  const tokenRole = parsed.participantToken.startsWith('3cb_pa1_')
    ? 'A'
    : parsed.participantToken.startsWith('3cb_pb1_')
      ? 'B'
      : null
  if (!tokenRole) return invalid()

  let response: Response
  try {
    response = await dependencies.fetch(
      `/api/duel/matches/${encodeURIComponent(parsed.matchId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${parsed.participantToken}` },
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

  const authenticated = parseAuthenticatedMatch(body, parsed.matchId, tokenRole)
  const participant = persistParticipantCapability(dependencies.storage, {
    matchId: authenticated.matchId,
    role: authenticated.role,
    token: parsed.participantToken,
  })

  const stored = readParticipant(dependencies.storage, authenticated.matchId)
  if (
    !stored ||
    stored.token !== parsed.participantToken ||
    stored.role !== authenticated.role ||
    stored.matchId !== authenticated.matchId ||
    stored.token !== participant.token
  ) {
    return invalid()
  }

  cleanPathAfterPersist(dependencies.history, parsed.cleanPath)

  return {
    kind: authenticated.role === 'A' ? 'participant-a' : 'participant-b',
    matchId: authenticated.matchId,
    participant: stored,
    totalRounds: authenticated.totalRounds,
    createdAt: authenticated.createdAt,
    expiresAt: authenticated.expiresAt,
    formationVersion: authenticated.formationVersion,
    ruleVersion: authenticated.ruleVersion,
    self: authenticated.self,
    opponent: authenticated.opponent,
  }
}
