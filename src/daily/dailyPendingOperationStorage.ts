import {
  type DailyChallengeDate,
  validateDailyChallengeDate,
} from './dailyChallengeDate'
import type { DailyStorageAdapter } from './dailyParticipantStorage'

export interface DailyPendingStorageAdapter extends DailyStorageAdapter {
  removeItem(key: string): void
}

export const DAILY_PENDING_OPERATION_KEY = '3cb:daily:v1:pending-operation'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PendingBase = {
  readonly version: 1
  readonly challengeDate: DailyChallengeDate
  readonly participantId: string
  readonly roundNumber: number
  readonly requestId: string
  readonly remainingSecondsAtTap: number
}

export type DailyPendingOperation =
  | (PendingBase & { readonly kind: 'open'; readonly bagNumber: number })
  | (PendingBase & { readonly kind: 'cash_out' })

export class DailyPendingOperationStorageError extends Error {
  constructor() {
    super('The pending DAILY operation could not be stored safely.')
    this.name = 'DailyPendingOperationStorageError'
  }
}

function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

export function validateDailyPendingOperation(
  value: unknown,
): DailyPendingOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  let challengeDate: DailyChallengeDate
  try {
    challengeDate = validateDailyChallengeDate(row.challengeDate)
  } catch {
    return null
  }
  const common =
    row.version === 1 &&
    row.challengeDate === challengeDate &&
    typeof row.participantId === 'string' &&
    UUID_V4.test(row.participantId) &&
    typeof row.requestId === 'string' &&
    UUID_V4.test(row.requestId) &&
    integer(row.roundNumber, 1, 20) &&
    integer(row.remainingSecondsAtTap, 1, 60)
  if (!common) return null

  if (row.kind === 'open') {
    if (!integer(row.bagNumber, 1, 8)) return null
    const keys = Object.keys(row).sort().join(',')
    if (
      keys !==
      'bagNumber,challengeDate,kind,participantId,remainingSecondsAtTap,requestId,roundNumber,version'
    ) {
      return null
    }
    return row as DailyPendingOperation
  }
  if (row.kind === 'cash_out') {
    const keys = Object.keys(row).sort().join(',')
    if (
      keys !==
      'challengeDate,kind,participantId,remainingSecondsAtTap,requestId,roundNumber,version'
    ) {
      return null
    }
    return row as DailyPendingOperation
  }
  return null
}

export function readDailyPendingOperation(
  storage: DailyPendingStorageAdapter,
): DailyPendingOperation | null {
  let raw: string | null
  try {
    raw = storage.getItem(DAILY_PENDING_OPERATION_KEY)
  } catch {
    throw new DailyPendingOperationStorageError()
  }
  if (raw === null) return null
  try {
    const parsed = validateDailyPendingOperation(JSON.parse(raw))
    if (parsed) return parsed
  } catch {
    // Invalid data is removed below and is never used for a request.
  }
  clearDailyPendingOperation(storage)
  return null
}

export function saveDailyPendingOperation(
  storage: DailyPendingStorageAdapter,
  operation: DailyPendingOperation,
): void {
  const validated = validateDailyPendingOperation(operation)
  if (!validated) throw new DailyPendingOperationStorageError()
  try {
    storage.setItem(DAILY_PENDING_OPERATION_KEY, JSON.stringify(validated))
    const stored = storage.getItem(DAILY_PENDING_OPERATION_KEY)
    if (!stored || !validateDailyPendingOperation(JSON.parse(stored))) {
      throw new Error('pending operation verification failed')
    }
  } catch {
    throw new DailyPendingOperationStorageError()
  }
}

export function clearDailyPendingOperation(
  storage: DailyPendingStorageAdapter,
): void {
  try {
    storage.removeItem(DAILY_PENDING_OPERATION_KEY)
  } catch {
    throw new DailyPendingOperationStorageError()
  }
}
