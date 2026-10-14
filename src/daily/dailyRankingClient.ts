/**
 * Browser client for DAILY personal RESULT (eng8) and RANKING (eng9B).
 * No ranking re-sort — server ranks are displayed as returned.
 */
import { validateDailyChallengeDate } from './dailyChallengeDate.js'
import { validateGroupNickname } from '../group/groupDomain.js'

export type DailyRankingClientErrorCode =
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'NETWORK'

export class DailyRankingClientError extends Error {
  readonly code: DailyRankingClientErrorCode

  constructor(code: DailyRankingClientErrorCode) {
    super('The DAILY result or ranking request failed.')
    this.name = 'DailyRankingClientError'
    this.code = code
  }
}

export interface DailySelfResultView {
  readonly challengeDate: string
  readonly participantId: string
  readonly nickname: string
  readonly acceptedAt: string
  readonly completedAt: string
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly coinBagHitRate: {
    readonly numerator: number
    readonly denominator: number
  }
}

export interface DailyRankingEntryView {
  readonly participantId: string
  readonly rank: number
  readonly nickname: string
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly coinBagHitRate: {
    readonly numerator: number
    readonly denominator: number
  }
  readonly isSelf: boolean
}

export interface DailyRankingView {
  readonly challengeDate: string
  readonly status: 'provisional' | 'final'
  readonly rankingAsOf: string
  readonly topEntries: readonly DailyRankingEntryView[]
  readonly self: DailyRankingEntryView
  readonly selfInTop: boolean
  readonly totalRankedParticipants: number
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(code: DailyRankingClientErrorCode = 'INVALID_RESPONSE'): never {
  throw new DailyRankingClientError(code)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail()
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...keys].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail()
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return fail()
  }
  return value
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return fail()
  return value.toLowerCase()
}

function iso(value: unknown): string {
  if (typeof value !== 'string') return fail()
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail()
  return value
}

function nickname(value: unknown): string {
  try {
    return validateGroupNickname(value)
  } catch {
    return fail()
  }
}

function hitRate(
  value: unknown,
  hits: number,
  opens: number,
): { readonly numerator: number; readonly denominator: number } {
  const rate = record(value)
  exact(rate, ['numerator', 'denominator'])
  const numerator = integer(rate.numerator, 0, opens)
  const denominator = integer(rate.denominator, 0, 20 * 8)
  if (numerator !== hits || denominator !== opens) return fail()
  return { numerator, denominator }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return fail('INVALID_RESPONSE')
  }
}

function classifyHttp(response: Response): never {
  if (response.status === 401) return fail('UNAUTHORIZED')
  if (response.status === 404) return fail('UNAVAILABLE')
  if (response.status === 400 || response.status === 405) return fail('INVALID_RESPONSE')
  return fail('NETWORK')
}

async function request(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(input, init)
  } catch {
    return fail('NETWORK')
  }
}

function parseEntry(
  value: unknown,
  maxRank: number,
): DailyRankingEntryView {
  const entry = record(value)
  exact(entry, [
    'participantId',
    'rank',
    'nickname',
    'totalCoins',
    'threeCoinsComplete',
    'coinBagHits',
    'totalOpens',
    'coinBagHitRate',
    'isSelf',
  ])
  if (typeof entry.isSelf !== 'boolean') return fail()
  const totalOpens = integer(entry.totalOpens, 0, 20 * 8)
  const coinBagHits = integer(entry.coinBagHits, 0, totalOpens)
  return {
    participantId: uuid(entry.participantId),
    rank: integer(entry.rank, 1, maxRank),
    nickname: nickname(entry.nickname),
    totalCoins: integer(entry.totalCoins, 0, 20 * 3),
    threeCoinsComplete: integer(entry.threeCoinsComplete, 0, 20),
    coinBagHits,
    totalOpens,
    coinBagHitRate: hitRate(entry.coinBagHitRate, coinBagHits, totalOpens),
    isSelf: entry.isSelf,
  }
}

/** Parses eng8 personal RESULT. Rejects date mismatch. Ignores rounds/time for list UI. */
export function parseDailySelfResult(
  value: unknown,
  expectedChallengeDate: string,
): DailySelfResultView {
  const expected = validateDailyChallengeDate(expectedChallengeDate)
  const body = record(value)
  if (body.challengeDate !== expected) return fail()
  // Allow eng8 extras (rounds, totalTimeSeconds, …) — list UI only needs scores.
  if (typeof body.totalTimeSeconds === 'number') {
    // present is fine; UI must not display it
  }
  const totalOpens = integer(body.totalOpens, 0, 20 * 8)
  const coinBagHits = integer(body.coinBagHits, 0, totalOpens)
  return {
    challengeDate: expected,
    participantId: uuid(body.participantId),
    nickname: nickname(body.nickname),
    acceptedAt: iso(body.acceptedAt),
    completedAt: iso(body.completedAt),
    totalCoins: integer(body.totalCoins, 0, 20 * 3),
    threeCoinsComplete: integer(body.threeCoinsComplete, 0, 20),
    coinBagHits,
    totalOpens,
    coinBagHitRate: hitRate(body.coinBagHitRate, coinBagHits, totalOpens),
  }
}

export function parseDailyRanking(
  value: unknown,
  expectedChallengeDate: string,
): DailyRankingView {
  const expected = validateDailyChallengeDate(expectedChallengeDate)
  const body = record(value)
  exact(body, [
    'challengeDate',
    'status',
    'rankingAsOf',
    'topEntries',
    'self',
    'selfInTop',
    'totalRankedParticipants',
  ])
  if (body.challengeDate !== expected) return fail()
  if (body.status !== 'provisional' && body.status !== 'final') return fail()
  if (typeof body.selfInTop !== 'boolean') return fail()
  if (!Array.isArray(body.topEntries)) return fail()
  if (body.topEntries.length > 10) return fail()
  const totalRankedParticipants = integer(body.totalRankedParticipants, 1, 1_000_000)
  const maxRank = totalRankedParticipants
  // TOTAL TIME must never appear on ranking payloads we accept for UI.
  if ('totalTimeSeconds' in body || 'totalTime' in body) return fail()
  for (const raw of [...body.topEntries, body.self]) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const row = raw as Record<string, unknown>
      if ('totalTimeSeconds' in row || 'totalTime' in row) return fail()
    }
  }
  const topEntries = body.topEntries.map((entry) => parseEntry(entry, maxRank))
  const self = parseEntry(body.self, maxRank)
  if (!self.isSelf) return fail()
  const selfInTop = topEntries.some(
    (entry) => entry.participantId === self.participantId,
  )
  if (selfInTop !== body.selfInTop) return fail()
  if (selfInTop) {
    const marked = topEntries.filter((entry) => entry.isSelf)
    if (marked.length !== 1 || marked[0]!.participantId !== self.participantId) {
      return fail()
    }
  } else if (topEntries.some((entry) => entry.isSelf)) {
    return fail()
  }
  return {
    challengeDate: expected,
    status: body.status,
    rankingAsOf: iso(body.rankingAsOf),
    topEntries,
    self,
    selfInTop: body.selfInTop,
    totalRankedParticipants,
  }
}

export async function fetchDailySelfResult(
  challengeDate: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<DailySelfResultView> {
  const date = validateDailyChallengeDate(challengeDate)
  const response = await request(
    fetcher,
    `/api/daily/challenges/${encodeURIComponent(date)}/result`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-store',
      },
    },
  )
  if (!response.ok) return classifyHttp(response)
  return parseDailySelfResult(await responseJson(response), date)
}

export async function fetchDailyRanking(
  challengeDate: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<DailyRankingView> {
  const date = validateDailyChallengeDate(challengeDate)
  const response = await request(
    fetcher,
    `/api/daily/challenges/${encodeURIComponent(date)}/ranking`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-store',
      },
    },
  )
  if (!response.ok) return classifyHttp(response)
  return parseDailyRanking(await responseJson(response), date)
}
