import type { RandomUuidCrypto } from '../browser/randomUuid'
import { randomUuid } from '../browser/randomUuid'
import { validateGroupNickname } from '../group/groupDomain'
import {
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from './dailyChallengeDate'

export const DAILY_JOIN_INTENT_VERSION = 1 as const
export const DAILY_JOIN_INTENT_DB_NAME = '3cb-daily-join-intents-v1'
export const DAILY_JOIN_INTENT_STORE_NAME = 'joinIntents'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DailyJoinIntent {
  readonly version: typeof DAILY_JOIN_INTENT_VERSION
  readonly challengeDate: DailyChallengeDate
  readonly joinRequestId: string
  readonly nickname: string
}

export interface DailyJoinIntentStore {
  /** Atomically returns the existing date record or commits the proposed one. */
  claim(proposed: DailyJoinIntent): Promise<DailyJoinIntent>
}

export class DailyJoinIntentStorageError extends Error {
  constructor() {
    super('DAILY join coordination is unavailable.')
    this.name = 'DailyJoinIntentStorageError'
  }
}

function fail(): never {
  throw new DailyJoinIntentStorageError()
}

export function validateDailyJoinIntent(
  value: unknown,
  expectedDate?: DailyChallengeDate,
): DailyJoinIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail()
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [
    'challengeDate',
    'joinRequestId',
    'nickname',
    'version',
  ].sort()
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return fail()
  }
  let challengeDate: DailyChallengeDate
  let nickname: string
  try {
    challengeDate = validateDailyChallengeDate(record.challengeDate)
    nickname = validateGroupNickname(record.nickname)
  } catch {
    return fail()
  }
  if (
    record.version !== DAILY_JOIN_INTENT_VERSION ||
    (expectedDate !== undefined && challengeDate !== expectedDate) ||
    typeof record.joinRequestId !== 'string' ||
    !UUID_V4_PATTERN.test(record.joinRequestId)
  ) {
    return fail()
  }
  return {
    version: DAILY_JOIN_INTENT_VERSION,
    challengeDate,
    joinRequestId: record.joinRequestId.toLowerCase(),
    nickname,
  }
}

export function createDailyJoinIntent(
  challengeDate: DailyChallengeDate,
  nicknameValue: unknown,
  cryptoSource: RandomUuidCrypto,
): DailyJoinIntent {
  return validateDailyJoinIntent({
    version: DAILY_JOIN_INTENT_VERSION,
    challengeDate,
    joinRequestId: randomUuid(cryptoSource),
    nickname: nicknameValue,
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DAILY_JOIN_INTENT_DB_NAME, 1)
    } catch {
      reject(new DailyJoinIntentStorageError())
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DAILY_JOIN_INTENT_STORE_NAME)) {
        database.createObjectStore(DAILY_JOIN_INTENT_STORE_NAME, {
          keyPath: 'challengeDate',
        })
      }
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      reject(new DailyJoinIntentStorageError())
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      reject(new DailyJoinIntentStorageError())
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

async function claimWithIndexedDb(
  factory: IDBFactory,
  proposedValue: DailyJoinIntent,
): Promise<DailyJoinIntent> {
  const proposed = validateDailyJoinIntent(proposedValue)
  const database = await openDatabase(factory)
  return new Promise((resolve, reject) => {
    let selected: DailyJoinIntent | null = null
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(
        DAILY_JOIN_INTENT_STORE_NAME,
        'readwrite',
      )
      const store = transaction.objectStore(DAILY_JOIN_INTENT_STORE_NAME)
      const get = store.get(proposed.challengeDate)
      get.onerror = () => transaction.abort()
      get.onsuccess = () => {
        try {
          if (get.result !== undefined) {
            selected = validateDailyJoinIntent(
              get.result,
              proposed.challengeDate,
            )
            return
          }
          selected = proposed
          store.add(proposed)
        } catch {
          transaction.abort()
        }
      }
    } catch {
      database.close()
      reject(new DailyJoinIntentStorageError())
      return
    }
    transaction.oncomplete = () => {
      database.close()
      if (selected === null) {
        reject(new DailyJoinIntentStorageError())
        return
      }
      resolve(selected)
    }
    transaction.onabort = () => {
      database.close()
      reject(new DailyJoinIntentStorageError())
    }
    transaction.onerror = () => {
      // onabort is the single rejection path.
    }
  })
}

export function createIndexedDbDailyJoinIntentStore(
  factory: IDBFactory,
): DailyJoinIntentStore {
  return {
    claim: (proposed) => claimWithIndexedDb(factory, proposed),
  }
}

export function browserDailyJoinIntentStore(): DailyJoinIntentStore | null {
  try {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
    return factory ? createIndexedDbDailyJoinIntentStore(factory) : null
  } catch {
    return null
  }
}
