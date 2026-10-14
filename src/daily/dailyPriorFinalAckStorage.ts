/**
 * Local ack that yesterday's FINAL ranking was confirmed before today's DAILY.
 * Server DB is never written — browser storage only (eng9F).
 */
import {
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from './dailyChallengeDate.js'
import type { DailyStorageAdapter } from './dailyParticipantStorage.js'
import { DailyParticipantStorageError } from './dailyParticipantStorage.js'

export const DAILY_PRIOR_FINAL_ACK_VERSION = 1 as const

export interface DailyPriorFinalAckRecord {
  readonly version: typeof DAILY_PRIOR_FINAL_ACK_VERSION
  /** The prior UTC challenge date whose FINAL was confirmed. */
  readonly priorChallengeDate: DailyChallengeDate
  /** UTC day when the player confirmed and entered today's flow. */
  readonly entryChallengeDate: DailyChallengeDate
  readonly acknowledgedAt: string
}

export function dailyPriorFinalAckStorageKey(priorChallengeDateValue: unknown): string {
  return `3cb:daily:v1:prior-final-ack:${validateDailyChallengeDate(priorChallengeDateValue)}`
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

function iso(value: unknown): string {
  if (typeof value !== 'string') return invalid()
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return invalid()
  }
  return value
}

export function validateDailyPriorFinalAckRecord(
  value: unknown,
  expectedPriorDateValue?: unknown,
): DailyPriorFinalAckRecord {
  const record = object(value)
  const priorChallengeDate = validateDailyChallengeDate(record.priorChallengeDate)
  if (
    expectedPriorDateValue !== undefined &&
    priorChallengeDate !== validateDailyChallengeDate(expectedPriorDateValue)
  ) {
    return invalid()
  }
  if (record.version !== DAILY_PRIOR_FINAL_ACK_VERSION) return invalid()
  const keys = Object.keys(record).sort()
  const wanted = [
    'acknowledgedAt',
    'entryChallengeDate',
    'priorChallengeDate',
    'version',
  ]
  if (keys.length !== wanted.length || keys.some((key, i) => key !== wanted[i])) {
    return invalid()
  }
  return {
    version: DAILY_PRIOR_FINAL_ACK_VERSION,
    priorChallengeDate,
    entryChallengeDate: validateDailyChallengeDate(record.entryChallengeDate),
    acknowledgedAt: iso(record.acknowledgedAt),
  }
}

export function readDailyPriorFinalAck(
  storage: DailyStorageAdapter,
  priorChallengeDate: DailyChallengeDate,
): DailyPriorFinalAckRecord | null {
  const key = dailyPriorFinalAckStorageKey(priorChallengeDate)
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    throw new DailyParticipantStorageError('READ_FAILED')
  }
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return invalid()
  }
  return validateDailyPriorFinalAckRecord(value, priorChallengeDate)
}

export function isDailyPriorFinalAcknowledged(
  storage: DailyStorageAdapter,
  priorChallengeDate: DailyChallengeDate,
): boolean {
  try {
    return readDailyPriorFinalAck(storage, priorChallengeDate) !== null
  } catch {
    // Unreadable ack storage → treat as not acknowledged (do not skip FINAL).
    return false
  }
}

/**
 * Persists ack only after a successful write+re-read.
 * Throws WRITE_FAILED when storage cannot confirm the save.
 */
export function saveDailyPriorFinalAck(
  storage: DailyStorageAdapter,
  input: {
    readonly priorChallengeDate: DailyChallengeDate
    readonly entryChallengeDate: DailyChallengeDate
    readonly acknowledgedAt?: string
  },
): DailyPriorFinalAckRecord {
  const record = validateDailyPriorFinalAckRecord({
    version: DAILY_PRIOR_FINAL_ACK_VERSION,
    priorChallengeDate: input.priorChallengeDate,
    entryChallengeDate: input.entryChallengeDate,
    acknowledgedAt: input.acknowledgedAt ?? new Date().toISOString(),
  })
  const key = dailyPriorFinalAckStorageKey(record.priorChallengeDate)
  try {
    storage.setItem(key, JSON.stringify(record))
  } catch {
    throw new DailyParticipantStorageError('WRITE_FAILED')
  }
  const stored = readDailyPriorFinalAck(storage, record.priorChallengeDate)
  if (JSON.stringify(stored) !== JSON.stringify(record)) {
    throw new DailyParticipantStorageError('WRITE_FAILED')
  }
  return record
}
