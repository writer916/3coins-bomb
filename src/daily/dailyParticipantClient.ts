import type { RandomUuidCrypto } from '../browser/randomUuid'
import { validateGroupNickname } from '../group/groupDomain'
import { utcDailyChallengeDate, type DailyChallengeDate } from './dailyChallengeDate'
import {
  createPendingDailyParticipant,
  readDailyParticipant,
  saveDailyParticipant,
  type DailyParticipantStorageRecord,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
} from './dailyParticipantStorage'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^3cb_dp1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

export type DailyParticipantClientErrorCode =
  | 'INVALID_INPUT'
  | 'NETWORK_FAILURE'
  | 'TEMPORARY_FAILURE'
  | 'AUTHENTICATION_FAILED'
  | 'CHALLENGE_UNAVAILABLE'
  | 'INVALID_RESPONSE'

export class DailyParticipantClientError extends Error {
  readonly code: DailyParticipantClientErrorCode

  constructor(code: DailyParticipantClientErrorCode) {
    super('The DAILY participant request could not be completed.')
    this.name = 'DailyParticipantClientError'
    this.code = code
  }
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
    return await fetcher(input, { ...init, cache: 'no-store' })
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
}

export interface DailyParticipantCoordinatorResult {
  readonly participant: JoinedDailyParticipantRecord
  readonly view: DailyParticipantView
  readonly restored: boolean
}

async function runDailyParticipant(
  nicknameValue: unknown,
  dependencies: DailyParticipantCoordinatorDependencies,
): Promise<DailyParticipantCoordinatorResult> {
  const challengeDate = utcDailyChallengeDate(
    dependencies.now?.() ?? new Date(),
  )
  const existing = readDailyParticipant(dependencies.storage, challengeDate)
  if (existing?.phase === 'joined') {
    const view = await fetchDailyParticipant(existing, dependencies.fetch)
    if (
      view.participantId !== existing.participantId ||
      view.nickname !== existing.nickname ||
      view.acceptedAt !== existing.acceptedAt
    ) {
      return fail('INVALID_RESPONSE')
    }
    return { participant: existing, view, restored: true }
  }

  let pending = existing
  if (pending === null) {
    let validatedNickname: string
    try {
      validatedNickname = validateGroupNickname(nicknameValue)
    } catch {
      return fail('INVALID_INPUT')
    }
    pending = createPendingDailyParticipant(
      challengeDate,
      validatedNickname,
      dependencies.crypto,
    )
  }
  if (existing === null) saveDailyParticipant(dependencies.storage, pending)
  const joined = await postDailyJoin(pending, dependencies.fetch)
  const participant = saveDailyParticipant(dependencies.storage, {
    version: 1,
    phase: 'joined',
    challengeDate,
    joinRequestId: pending.joinRequestId,
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
