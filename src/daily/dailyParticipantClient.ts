import type { RandomUuidCrypto } from '../browser/randomUuid'
import { validateGroupNickname } from '../group/groupDomain'
import { utcDailyChallengeDate, type DailyChallengeDate } from './dailyChallengeDate'
import {
  browserDailyJoinIntentStore,
  type DailyJoinIntent,
  type DailyJoinIntentStore,
  validateDailyJoinIntent,
} from './dailyJoinIntentStorage'
import {
  createPendingDailyParticipant,
  dailyJoinLockName,
  readDailyParticipant,
  saveDailyParticipant,
  type DailyParticipantStorageRecord,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
  type PendingDailyParticipantRecord,
} from './dailyParticipantStorage'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^3cb_dp1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const DATE_ROLLOVER_ATTEMPTS = 3

export type DailyParticipantClientErrorCode =
  | 'INVALID_INPUT'
  | 'NETWORK_FAILURE'
  | 'TEMPORARY_FAILURE'
  | 'AUTHENTICATION_FAILED'
  | 'CHALLENGE_UNAVAILABLE'
  | 'COORDINATION_UNAVAILABLE'
  | 'COORDINATION_CONFLICT'
  | 'INVALID_RESPONSE'

export class DailyParticipantClientError extends Error {
  readonly code: DailyParticipantClientErrorCode

  constructor(code: DailyParticipantClientErrorCode) {
    super('The DAILY participant request could not be completed.')
    this.name = 'DailyParticipantClientError'
    this.code = code
  }
}

/** Minimal LockManager surface so tests can inject serialization without DOM types. */
export interface DailyJoinLockManager {
  request<T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T>
}

interface JoinResponse {
  readonly challengeDate: DailyChallengeDate
  readonly participantId: string
  readonly nickname: string
  readonly token: string
  readonly acceptedAt: string
}

export interface DailyParticipantView {
  readonly challengeDate: DailyChallengeDate
  readonly participantId: string
  readonly nickname: string
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

function fail(code: DailyParticipantClientErrorCode): never {
  throw new DailyParticipantClientError(code)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('INVALID_RESPONSE')
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
    return fail('INVALID_RESPONSE')
  }
}

function iso(value: unknown): string {
  if (typeof value !== 'string') return fail('INVALID_RESPONSE')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return fail('INVALID_RESPONSE')
  }
  return value
}

function optionalIso(value: unknown): string | null {
  return value === null ? null : iso(value)
}

function nickname(value: unknown): string {
  try {
    return validateGroupNickname(value)
  } catch {
    return fail('INVALID_RESPONSE')
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return fail('INVALID_RESPONSE')
  }
}

async function request(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    // Native window.fetch requires the Window receiver in some browsers.
    // Use the same receiver contract for injected fetch implementations so
    // JOIN and participant restore behave consistently.
    return await fetcher.call(globalThis, input, { ...init, cache: 'no-store' })
  } catch {
    return fail('NETWORK_FAILURE')
  }
}

async function classifyFailure(
  response: Response,
  authenticated: boolean,
): Promise<never> {
  if (response.status === 400) return fail('INVALID_INPUT')
  if (response.status === 401 || (authenticated && response.status === 404)) {
    return fail('AUTHENTICATION_FAILED')
  }
  if (response.status === 409) return fail('CHALLENGE_UNAVAILABLE')
  if (response.status >= 500) return fail('TEMPORARY_FAILURE')
  return fail('INVALID_RESPONSE')
}

function parseJoinResponse(
  value: unknown,
  expectedDate: DailyChallengeDate,
): JoinResponse {
  const record = object(value)
  exactKeys(record, [
    'challengeDate',
    'participantId',
    'nickname',
    'token',
    'acceptedAt',
  ])
  if (
    record.challengeDate !== expectedDate ||
    typeof record.participantId !== 'string' ||
    !UUID_V4_PATTERN.test(record.participantId) ||
    typeof record.token !== 'string' ||
    !TOKEN_PATTERN.test(record.token)
  ) {
    return fail('INVALID_RESPONSE')
  }
  return {
    challengeDate: expectedDate,
    participantId: record.participantId.toLowerCase(),
    nickname: nickname(record.nickname),
    token: record.token,
    acceptedAt: iso(record.acceptedAt),
  }
}

function parseParticipantResponse(
  value: unknown,
  expectedDate: DailyChallengeDate,
): DailyParticipantView {
  const record = object(value)
  exactKeys(record, [
    'challengeDate',
    'participantId',
    'nickname',
    'acceptedAt',
    'completedAt',
    'expiredAt',
  ])
  if (
    record.challengeDate !== expectedDate ||
    typeof record.participantId !== 'string' ||
    !UUID_V4_PATTERN.test(record.participantId)
  ) {
    return fail('INVALID_RESPONSE')
  }
  return {
    challengeDate: expectedDate,
    participantId: record.participantId.toLowerCase(),
    nickname: nickname(record.nickname),
    acceptedAt: iso(record.acceptedAt),
    completedAt: optionalIso(record.completedAt),
    expiredAt: optionalIso(record.expiredAt),
  }
}

export async function postDailyJoin(
  record: Extract<DailyParticipantStorageRecord, { phase: 'pending-join' }>,
  fetcher: typeof fetch,
): Promise<JoinResponse> {
  const response = await request(
    fetcher,
    '/api/daily/challenges/current/participants',
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nickname: record.nickname,
        joinRequestId: record.joinRequestId,
      }),
    },
  )
  if (!response.ok) return classifyFailure(response, false)
  return parseJoinResponse(await responseJson(response), record.challengeDate)
}

export async function fetchDailyParticipant(
  record: JoinedDailyParticipantRecord,
  fetcher: typeof fetch,
): Promise<DailyParticipantView> {
  const response = await request(
    fetcher,
    `/api/daily/challenges/${encodeURIComponent(record.challengeDate)}/participant`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${record.token}`,
        'Cache-Control': 'no-store',
      },
    },
  )
  if (!response.ok) return classifyFailure(response, true)
  return parseParticipantResponse(
    await responseJson(response),
    record.challengeDate,
  )
}

export interface DailyParticipantCoordinatorDependencies {
  readonly storage: DailyStorageAdapter
  readonly fetch: typeof fetch
  readonly crypto: RandomUuidCrypto
  readonly now?: () => Date
  /**
   * Inject Web Locks for tests. `undefined` uses `navigator.locks` when present.
   * `null` forces the no-lock fallback (re-read before JOIN only).
   */
  readonly locks?: DailyJoinLockManager | null
  /** Injected atomic fallback. `null` means unavailable; undefined uses IndexedDB. */
  readonly joinIntents?: DailyJoinIntentStore | null
}

export interface DailyParticipantCoordinatorResult {
  readonly participant: JoinedDailyParticipantRecord
  readonly view: DailyParticipantView
  readonly restored: boolean
}

type LockedOutcome =
  | { readonly kind: 'ok'; readonly result: DailyParticipantCoordinatorResult }
  | { readonly kind: 'date-changed' }

function resolveLocks(
  override: DailyJoinLockManager | null | undefined,
): DailyJoinLockManager | null {
  if (override === null) return null
  if (override !== undefined) return override
  const locks = (
    globalThis as { navigator?: { locks?: DailyJoinLockManager } }
  ).navigator?.locks
  return locks ?? null
}

function resolveJoinIntents(
  override: DailyJoinIntentStore | null | undefined,
): DailyJoinIntentStore | null {
  return override === undefined ? browserDailyJoinIntentStore() : override
}

function samePendingAndIntent(
  pending: PendingDailyParticipantRecord,
  intent: DailyJoinIntent,
): boolean {
  return (
    pending.challengeDate === intent.challengeDate &&
    pending.joinRequestId === intent.joinRequestId &&
    pending.nickname === intent.nickname
  )
}

async function withDailyJoinLock<T>(
  challengeDate: DailyChallengeDate,
  locks: DailyJoinLockManager | null,
  run: () => Promise<T>,
): Promise<T> {
  if (!locks) return run()
  return locks.request(dailyJoinLockName(challengeDate), async () => run())
}

async function restoreJoined(
  existing: JoinedDailyParticipantRecord,
  fetcher: typeof fetch,
): Promise<DailyParticipantCoordinatorResult> {
  const view = await fetchDailyParticipant(existing, fetcher)
  if (
    view.participantId !== existing.participantId ||
    view.nickname !== existing.nickname ||
    view.acceptedAt !== existing.acceptedAt
  ) {
    return fail('INVALID_RESPONSE')
  }
  return { participant: existing, view, restored: true }
}

function toJoinedResult(
  challengeDate: DailyChallengeDate,
  joined: JoinResponse,
  joinRequestId: string,
  storage: DailyStorageAdapter,
): DailyParticipantCoordinatorResult {
  const participant = saveDailyParticipant(storage, {
    version: 1,
    phase: 'joined',
    challengeDate,
    joinRequestId,
    participantId: joined.participantId,
    nickname: joined.nickname,
    token: joined.token,
    acceptedAt: joined.acceptedAt,
  }) as JoinedDailyParticipantRecord
  return {
    participant,
    view: {
      challengeDate,
      participantId: joined.participantId,
      nickname: joined.nickname,
      acceptedAt: joined.acceptedAt,
      completedAt: null,
      expiredAt: null,
    },
    restored: false,
  }
}

/**
 * Join/restore body. Callers must re-read storage after any wait (e.g. lock
 * acquisition); pre-wait "empty" decisions must not be reused.
 */
async function executeJoinOrRestore(
  nicknameValue: unknown,
  challengeDate: DailyChallengeDate,
  dependencies: DailyParticipantCoordinatorDependencies,
  now: () => Date,
  joinIntents: DailyJoinIntentStore | null,
  hasJoinLock: boolean,
): Promise<DailyParticipantCoordinatorResult | 'date-changed'> {
  const existing = readDailyParticipant(dependencies.storage, challengeDate)
  if (existing?.phase === 'joined') {
    return restoreJoined(existing, dependencies.fetch)
  }

  let pending: PendingDailyParticipantRecord | null =
    existing?.phase === 'pending-join' ? existing : null
  if (pending === null) {
    let validatedNickname: string
    try {
      validatedNickname = validateGroupNickname(nicknameValue)
    } catch {
      return fail('INVALID_INPUT')
    }
    pending = createPendingDailyParticipant(challengeDate, validatedNickname, dependencies.crypto)
  }

  if (joinIntents) {
    const proposed = validateDailyJoinIntent({
      version: 1,
      challengeDate,
      nickname: pending.nickname,
      joinRequestId: pending.joinRequestId,
    })
    let canonical: DailyJoinIntent
    try {
      canonical = await joinIntents.claim(proposed)
    } catch {
      return fail('COORDINATION_UNAVAILABLE')
    }
    if (existing?.phase === 'pending-join' && !samePendingAndIntent(existing, canonical)) {
      // The existing request may already have reached the server. Never replace
      // it with another id because that could create a second participant.
      return fail('COORDINATION_CONFLICT')
    }
    pending = {
      version: 1,
      phase: 'pending-join',
      challengeDate: canonical.challengeDate,
      joinRequestId: canonical.joinRequestId,
      nickname: canonical.nickname,
    }
  } else if (!hasJoinLock) {
    return fail('COORDINATION_UNAVAILABLE')
  }

  const beforeSave = readDailyParticipant(dependencies.storage, challengeDate)
  if (beforeSave?.phase === 'joined') {
    return restoreJoined(beforeSave, dependencies.fetch)
  }
  if (
    beforeSave?.phase === 'pending-join' &&
    !samePendingAndIntent(beforeSave, pending)
  ) {
    return fail('COORDINATION_CONFLICT')
  }
  if (beforeSave === null) saveDailyParticipant(dependencies.storage, pending)

  /*
   * Prefer any record another tab may have written (especially without Web
   * Locks). Never invent a second request id when storage already has one.
   */
  const latest = readDailyParticipant(dependencies.storage, challengeDate)
  if (latest?.phase === 'joined') {
    return restoreJoined(latest, dependencies.fetch)
  }
  if (latest?.phase === 'pending-join') {
    pending = latest
  }

  if (utcDailyChallengeDate(now()) !== challengeDate) {
    /*
     * Date rolled over after lock wait / before network. Abort this day's JOIN
     * so the outer retry can re-evaluate under the new UTC date.
     */
    return 'date-changed'
  }

  const joined = await postDailyJoin(pending, dependencies.fetch)
  return toJoinedResult(
    challengeDate,
    joined,
    pending.joinRequestId,
    dependencies.storage,
  )
}

async function runDailyParticipant(
  nicknameValue: unknown,
  dependencies: DailyParticipantCoordinatorDependencies,
): Promise<DailyParticipantCoordinatorResult> {
  const locks = resolveLocks(dependencies.locks)
  const joinIntents = locks ? null : resolveJoinIntents(dependencies.joinIntents)
  const now = () => dependencies.now?.() ?? new Date()

  for (let attempt = 0; attempt < DATE_ROLLOVER_ATTEMPTS; attempt += 1) {
    const challengeDate = utcDailyChallengeDate(now())
    const outcome = await withDailyJoinLock(
      challengeDate,
      locks,
      async (): Promise<LockedOutcome> => {
        const lockedDate = utcDailyChallengeDate(now())
        if (lockedDate !== challengeDate) {
          return { kind: 'date-changed' }
        }
        const result = await executeJoinOrRestore(
          nicknameValue,
          challengeDate,
          dependencies,
          now,
          joinIntents,
          locks !== null,
        )
        if (result === 'date-changed') return { kind: 'date-changed' }
        return { kind: 'ok', result }
      },
    )
    if (outcome.kind === 'ok') return outcome.result
  }

  return fail('CHALLENGE_UNAVAILABLE')
}

export function createDailyParticipantCoordinator(
  dependencies: DailyParticipantCoordinatorDependencies,
): {
  run(nickname: unknown): Promise<DailyParticipantCoordinatorResult>
} {
  let inFlight: Promise<DailyParticipantCoordinatorResult> | null = null
  return {
    run(nicknameValue) {
      if (inFlight) return inFlight
      inFlight = runDailyParticipant(nicknameValue, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
