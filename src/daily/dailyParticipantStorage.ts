import { randomUuid, type RandomUuidCrypto } from '../browser/randomUuid'
import { validateGroupNickname } from '../group/groupDomain'
import {
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from './dailyChallengeDate'

export const DAILY_PARTICIPANT_STORAGE_VERSION = 1 as const
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^3cb_dp1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export interface DailyStorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PendingDailyParticipantRecord {
  readonly version: typeof DAILY_PARTICIPANT_STORAGE_VERSION
  readonly phase: 'pending-join'
  readonly challengeDate: DailyChallengeDate
  readonly joinRequestId: string
  readonly nickname: string
}

export interface JoinedDailyParticipantRecord {
  readonly version: typeof DAILY_PARTICIPANT_STORAGE_VERSION
  readonly phase: 'joined'
  readonly challengeDate: DailyChallengeDate
  readonly joinRequestId: string
  readonly participantId: string
  readonly nickname: string
  readonly token: string
  readonly acceptedAt: string
}

export type DailyParticipantStorageRecord =
  | PendingDailyParticipantRecord
  | JoinedDailyParticipantRecord

export type DailyParticipantStorageErrorCode =
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'INVALID_DATA'

export class DailyParticipantStorageError extends Error {
  readonly code: DailyParticipantStorageErrorCode

  constructor(code: DailyParticipantStorageErrorCode) {
    super('DAILY browser data could not be stored or recovered.')
    this.name = 'DailyParticipantStorageError'
    this.code = code
  }
}

function invalid(): never {
  throw new DailyParticipantStorageError('INVALID_DATA')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    return invalid()
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return invalid()
  return value.toLowerCase()
}

function iso(value: unknown): string {
  if (typeof value !== 'string') return invalid()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return invalid()
  }
  return value
}

export function dailyParticipantStorageKey(dateValue: unknown): string {
  return `3cb:daily:v1:participant:${validateDailyChallengeDate(dateValue)}`
}

export function validateDailyParticipantStorageRecord(
  value: unknown,
  expectedDateValue?: unknown,
): DailyParticipantStorageRecord {
  const record = object(value)
  const challengeDate = validateDailyChallengeDate(record.challengeDate)
  if (
    expectedDateValue !== undefined &&
    challengeDate !== validateDailyChallengeDate(expectedDateValue)
  ) {
    return invalid()
  }
  let nickname: string
  try {
    nickname = validateGroupNickname(record.nickname)
  } catch {
    return invalid()
  }
  if (
    record.version !== DAILY_PARTICIPANT_STORAGE_VERSION ||
    (record.phase !== 'pending-join' && record.phase !== 'joined')
  ) {
    return invalid()
  }
  const joinRequestId = uuid(record.joinRequestId)
  if (record.phase === 'pending-join') {
    exactKeys(record, [
      'version',
      'phase',
      'challengeDate',
      'joinRequestId',
      'nickname',
    ])
    return {
      version: DAILY_PARTICIPANT_STORAGE_VERSION,
      phase: 'pending-join',
      challengeDate,
      joinRequestId,
      nickname,
    }
  }
  exactKeys(record, [
    'version',
    'phase',
    'challengeDate',
    'joinRequestId',
    'participantId',
    'nickname',
    'token',
    'acceptedAt',
  ])
  if (typeof record.token !== 'string' || !TOKEN_PATTERN.test(record.token)) {
    return invalid()
  }
  return {
    version: DAILY_PARTICIPANT_STORAGE_VERSION,
    phase: 'joined',
    challengeDate,
    joinRequestId,
    participantId: uuid(record.participantId),
    nickname,
    token: record.token,
    acceptedAt: iso(record.acceptedAt),
  }
}

function readRaw(storage: DailyStorageAdapter, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    throw new DailyParticipantStorageError('READ_FAILED')
  }
}

export function readDailyParticipant(
  storage: DailyStorageAdapter,
  challengeDate: DailyChallengeDate,
): DailyParticipantStorageRecord | null {
  const key = dailyParticipantStorageKey(challengeDate)
  const raw = readRaw(storage, key)
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return invalid()
  }
  return validateDailyParticipantStorageRecord(value, challengeDate)
}

export function saveDailyParticipant(
  storage: DailyStorageAdapter,
  value: DailyParticipantStorageRecord,
): DailyParticipantStorageRecord {
  const record = validateDailyParticipantStorageRecord(value)
  const key = dailyParticipantStorageKey(record.challengeDate)
  try {
    storage.setItem(key, JSON.stringify(record))
  } catch {
    throw new DailyParticipantStorageError('WRITE_FAILED')
  }
  const stored = readDailyParticipant(storage, record.challengeDate)
  if (JSON.stringify(stored) !== JSON.stringify(record)) {
    throw new DailyParticipantStorageError('WRITE_FAILED')
  }
  return record
}

export function createPendingDailyParticipant(
  challengeDate: DailyChallengeDate,
  nicknameValue: unknown,
  cryptoSource: RandomUuidCrypto = globalThis.crypto,
): PendingDailyParticipantRecord {
  let nickname: string
  try {
    nickname = validateGroupNickname(nicknameValue)
  } catch {
    return invalid()
  }
  return validateDailyParticipantStorageRecord({
    version: DAILY_PARTICIPANT_STORAGE_VERSION,
    phase: 'pending-join',
    challengeDate,
    joinRequestId: randomUuid(cryptoSource),
    nickname,
  }) as PendingDailyParticipantRecord
}
