import {
  GROUP_FORMATION_VERSION,
  GROUP_PLAYERS_MAX,
  GROUP_PLAYERS_MIN,
  GROUP_ROUNDS_MAX,
  GROUP_ROUNDS_MIN,
  GROUP_RULE_VERSION,
  GROUP_SCORING_VERSION,
  validateGroupNickname,
} from './groupDomain'

export const GROUP_STORAGE_VERSION = 1 as const
export const GROUP_PENDING_CREATE_KEY = '3cb:group:v1:pending-create'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVITATION_PATTERN = /^3cb_gi1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const HOST_PATTERN = /^3cb_gh1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const PARTICIPANT_PATTERN = /^3cb_gp1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export interface GroupStorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PendingGroupCreateRecord {
  readonly version: typeof GROUP_STORAGE_VERSION
  readonly phase: 'pending-create'
  readonly createRequestId: string
  readonly totalRounds: number
  readonly playerLimit: number
}

export interface GroupHostRecord {
  readonly version: typeof GROUP_STORAGE_VERSION
  readonly groupId: string
  readonly invitationToken: string
  readonly hostToken: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly formationVersion: typeof GROUP_FORMATION_VERSION
  readonly ruleVersion: typeof GROUP_RULE_VERSION
  readonly scoringVersion: typeof GROUP_SCORING_VERSION
}

export interface GroupParticipantRecord {
  readonly version: typeof GROUP_STORAGE_VERSION
  readonly groupId: string
  readonly participantId: string
  readonly displayNickname: string
  readonly token: string
  readonly acceptedAt: string
}

export class GroupStorageError extends Error {
  constructor() {
    super('GROUP browser data could not be stored or recovered.')
    this.name = 'GroupStorageError'
  }
}

function invalid(): never {
  throw new GroupStorageError()
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return invalid()
  }
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    return invalid()
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return invalid()
  return value.toLowerCase()
}

export function groupHostStorageKey(groupIdValue: string): string {
  return `3cb:group:v1:host:${uuid(groupIdValue)}`
}

export function groupParticipantStorageKey(groupIdValue: string): string {
  return `3cb:group:v1:participant:${uuid(groupIdValue)}`
}

export function validatePendingGroupCreate(value: unknown): PendingGroupCreateRecord {
  const record = object(value)
  exactKeys(record, ['version', 'phase', 'createRequestId', 'totalRounds', 'playerLimit'])
  if (record.version !== GROUP_STORAGE_VERSION || record.phase !== 'pending-create') return invalid()
  return {
    version: GROUP_STORAGE_VERSION,
    phase: 'pending-create',
    createRequestId: uuid(record.createRequestId),
    totalRounds: integer(record.totalRounds, GROUP_ROUNDS_MIN, GROUP_ROUNDS_MAX),
    playerLimit: integer(record.playerLimit, GROUP_PLAYERS_MIN, GROUP_PLAYERS_MAX),
  }
}

export function validateGroupHostRecord(value: unknown): GroupHostRecord {
  const record = object(value)
  exactKeys(record, [
    'version', 'groupId', 'invitationToken', 'hostToken', 'totalRounds',
    'playerLimit', 'formationVersion', 'ruleVersion', 'scoringVersion',
  ])
  if (
    record.version !== GROUP_STORAGE_VERSION ||
    typeof record.invitationToken !== 'string' ||
    !INVITATION_PATTERN.test(record.invitationToken) ||
    typeof record.hostToken !== 'string' ||
    !HOST_PATTERN.test(record.hostToken) ||
    record.formationVersion !== GROUP_FORMATION_VERSION ||
    record.ruleVersion !== GROUP_RULE_VERSION ||
    record.scoringVersion !== GROUP_SCORING_VERSION
  ) return invalid()
  return {
    version: GROUP_STORAGE_VERSION,
    groupId: uuid(record.groupId),
    invitationToken: record.invitationToken,
    hostToken: record.hostToken,
    totalRounds: integer(record.totalRounds, GROUP_ROUNDS_MIN, GROUP_ROUNDS_MAX),
    playerLimit: integer(record.playerLimit, GROUP_PLAYERS_MIN, GROUP_PLAYERS_MAX),
    formationVersion: GROUP_FORMATION_VERSION,
    ruleVersion: GROUP_RULE_VERSION,
    scoringVersion: GROUP_SCORING_VERSION,
  }
}

export function validateGroupParticipantRecord(value: unknown): GroupParticipantRecord {
  const record = object(value)
  exactKeys(record, [
    'version', 'groupId', 'participantId', 'displayNickname', 'token', 'acceptedAt',
  ])
  let displayNickname: string
  try {
    displayNickname = validateGroupNickname(record.displayNickname)
  } catch {
    return invalid()
  }
  if (
    record.version !== GROUP_STORAGE_VERSION ||
    typeof record.token !== 'string' ||
    !PARTICIPANT_PATTERN.test(record.token) ||
    typeof record.acceptedAt !== 'string'
  ) return invalid()
  let acceptedAt: string
  try {
    acceptedAt = new Date(record.acceptedAt).toISOString()
  } catch {
    return invalid()
  }
  if (acceptedAt !== record.acceptedAt) return invalid()
  return {
    version: GROUP_STORAGE_VERSION,
    groupId: uuid(record.groupId),
    participantId: uuid(record.participantId),
    displayNickname,
    token: record.token,
    acceptedAt,
  }
}

function readJson(storage: GroupStorageAdapter, key: string): unknown | null {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return invalid()
  }
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return invalid()
  }
}

function writeVerified<T>(
  storage: GroupStorageAdapter,
  key: string,
  value: T,
  validate: (candidate: unknown) => T,
): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    return invalid()
  }
  const stored = readJson(storage, key)
  const checked = validate(stored)
  if (JSON.stringify(checked) !== JSON.stringify(value)) return invalid()
}

export function createPendingGroupCreate(
  totalRounds: number,
  playerLimit: number,
  cryptoSource: Pick<Crypto, 'randomUUID'> = globalThis.crypto,
): PendingGroupCreateRecord {
  return validatePendingGroupCreate({
    version: GROUP_STORAGE_VERSION,
    phase: 'pending-create',
    createRequestId: cryptoSource.randomUUID(),
    totalRounds,
    playerLimit,
  })
}

export function readPendingGroupCreate(
  storage: GroupStorageAdapter,
): PendingGroupCreateRecord | null {
  const value = readJson(storage, GROUP_PENDING_CREATE_KEY)
  return value === null ? null : validatePendingGroupCreate(value)
}

export function savePendingGroupCreate(
  storage: GroupStorageAdapter,
  record: PendingGroupCreateRecord,
): void {
  const checked = validatePendingGroupCreate(record)
  writeVerified(storage, GROUP_PENDING_CREATE_KEY, checked, validatePendingGroupCreate)
}

export function readGroupHost(
  storage: GroupStorageAdapter,
  groupId: string,
): GroupHostRecord | null {
  const value = readJson(storage, groupHostStorageKey(groupId))
  return value === null ? null : validateGroupHostRecord(value)
}

export function readGroupParticipant(
  storage: GroupStorageAdapter,
  groupId: string,
): GroupParticipantRecord | null {
  const value = readJson(storage, groupParticipantStorageKey(groupId))
  return value === null ? null : validateGroupParticipantRecord(value)
}

export function saveGroupParticipant(
  storage: GroupStorageAdapter,
  value: GroupParticipantRecord,
): GroupParticipantRecord {
  const record = validateGroupParticipantRecord(value)
  writeVerified(
    storage,
    groupParticipantStorageKey(record.groupId),
    record,
    validateGroupParticipantRecord,
  )
  return record
}

/** Host/invite are durable before pending-create is removed. */
export function completeGroupCreate(
  storage: GroupStorageAdapter,
  value: GroupHostRecord,
): GroupHostRecord {
  const record = validateGroupHostRecord(value)
  writeVerified(storage, groupHostStorageKey(record.groupId), record, validateGroupHostRecord)
  try {
    storage.removeItem(GROUP_PENDING_CREATE_KEY)
  } catch {
    return invalid()
  }
  if (readPendingGroupCreate(storage) !== null) return invalid()
  return record
}
