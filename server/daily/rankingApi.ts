import { parseBearerToken } from '../auth/duelTokens.js'
import {
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import {
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from '../../src/daily/dailyChallengeDate.js'
import {
  buildDailyRankingSelection,
  resolveDailyRankingWindow,
  type DailyRankingCandidate,
  type DailyRankingSelection,
  type DailyRankingWindow,
  type RankedDailyParticipant,
} from '../../src/daily/dailyRanking.js'
import {
  loadDailyResultSource,
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultParticipantRow,
} from '../db/dailyResult.js'
import { loadDailyRankingPool } from '../db/dailyRanking.js'

export class DailyRankingApiError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'UNAVAILABLE'

  constructor(code: DailyRankingApiError['code']) {
    super('The DAILY ranking request could not be completed.')
    this.name = 'DailyRankingApiError'
    this.code = code
  }
}

export interface DailyRankingAuth {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}

export interface DailyRankingEntryResponse {
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

/** Ranking list payload — no TOTAL TIME, rounds, placements, or tokens. */
export interface DailyRankingResponse {
  readonly challengeDate: string
  readonly status: 'provisional' | 'final'
  readonly rankingAsOf: string
  readonly topEntries: readonly DailyRankingEntryResponse[]
  readonly self: DailyRankingEntryResponse
  readonly selfInTop: boolean
  readonly totalRankedParticipants: number
}

export type LoadDailyRankingSelf = (input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}) => Promise<{
  readonly participant: DailyResultParticipantRow
  readonly attempts: readonly DailyAttemptResultRow[]
} | null>

export type LoadDailyRankingCandidates = (input: {
  readonly challengeDate: DailyChallengeDate
  readonly window: DailyRankingWindow
}) => Promise<readonly DailyRankingCandidate[]>

export interface DailyRankingApiDependencies {
  readonly loadSelf?: LoadDailyRankingSelf
  readonly loadCandidates?: LoadDailyRankingCandidates
  readonly now?: () => Date
}

function toEntry(
  ranked: RankedDailyParticipant,
  selfParticipantId: string,
): DailyRankingEntryResponse {
  return {
    participantId: ranked.participantId,
    rank: ranked.rank,
    nickname: ranked.displayNickname,
    totalCoins: ranked.totalCoins,
    threeCoinsComplete: ranked.threeCoinsComplete,
    coinBagHits: ranked.coinBagHits,
    totalOpens: ranked.totalOpens,
    coinBagHitRate: {
      numerator: ranked.coinBagHitRate.numerator,
      denominator: ranked.coinBagHitRate.denominator,
    },
    isSelf: ranked.participantId === selfParticipantId,
  }
}

export function toDailyRankingResponse(
  challengeDate: string,
  window: DailyRankingWindow,
  selection: DailyRankingSelection,
): DailyRankingResponse {
  const selfId = selection.self.participantId
  return {
    challengeDate,
    status: window.status,
    rankingAsOf: window.rankingAsOf,
    topEntries: selection.topEntries.map((entry) => toEntry(entry, selfId)),
    self: toEntry(selection.self, selfId),
    selfInTop: selection.selfInTop,
    totalRankedParticipants: selection.totalRankedParticipants,
  }
}

export function validateDailyRankingAuth(
  dateValue: unknown,
  authorization: unknown,
): DailyRankingAuth {
  let challengeDate: DailyChallengeDate
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyRankingApiError('INVALID_REQUEST')
  }
  try {
    const token = validateDailyParticipantCapability(
      parseBearerToken(authorization),
    )
    return {
      challengeDate,
      authTokenHash: hashDailyParticipantCapability(token),
    }
  } catch {
    throw new DailyRankingApiError('UNAUTHORIZED')
  }
}

/**
 * Authenticated finished participant only. Incomplete / mid-bucket (not yet in
 * the provisional snapshot) / corrupt data → UNAVAILABLE (404).
 */
export async function readDailyRanking(
  auth: DailyRankingAuth,
  dependencies: DailyRankingApiDependencies = {},
): Promise<DailyRankingResponse> {
  const loadSelf = dependencies.loadSelf ?? loadDailyResultSource
  const loadCandidates = dependencies.loadCandidates ?? loadDailyRankingPool
  const now = dependencies.now ?? (() => new Date())

  let window: DailyRankingWindow
  try {
    window = resolveDailyRankingWindow(auth.challengeDate, now())
  } catch {
    throw new DailyRankingApiError('UNAVAILABLE')
  }

  const selfSource = await loadSelf({
    challengeDate: auth.challengeDate,
    authTokenHash: auth.authTokenHash,
  })
  if (!selfSource) throw new DailyRankingApiError('UNAVAILABLE')
  if (selfSource.participant.challengeDate !== auth.challengeDate) {
    throw new DailyRankingApiError('UNAVAILABLE')
  }
  if (selfSource.participant.completedAt === null) {
    throw new DailyRankingApiError('UNAVAILABLE')
  }
  if (selfSource.participant.expiredAt !== null) {
    throw new DailyRankingApiError('UNAVAILABLE')
  }

  const selfSummary = tryBuildDailyParticipantResultSummary(
    selfSource.participant,
    selfSource.attempts,
  )
  if (!selfSummary || selfSummary.challengeDate !== auth.challengeDate) {
    throw new DailyRankingApiError('UNAVAILABLE')
  }

  // Mid-bucket finishers wait until the next UTC 10-minute boundary.
  if (window.status === 'provisional') {
    const completedMs = Date.parse(selfSource.participant.completedAt)
    const asOfMs = Date.parse(window.rankingAsOf)
    if (
      !Number.isFinite(completedMs) ||
      !Number.isFinite(asOfMs) ||
      completedMs > asOfMs
    ) {
      throw new DailyRankingApiError('UNAVAILABLE')
    }
  }

  const candidates = await loadCandidates({
    challengeDate: auth.challengeDate,
    window,
  })

  // Ensure self is present even if the pool loader omitted them (defensive).
  const selfId = selfSummary.participantId
  const hasSelf = candidates.some(
    (candidate) => candidate.summary.participantId === selfId,
  )
  const pool = hasSelf
    ? candidates
    : [
        ...candidates,
        {
          summary: selfSummary,
          completedAt: selfSource.participant.completedAt,
        },
      ]

  let selection: DailyRankingSelection
  try {
    selection = buildDailyRankingSelection(pool, window, selfId)
  } catch {
    throw new DailyRankingApiError('UNAVAILABLE')
  }

  return toDailyRankingResponse(auth.challengeDate, window, selection)
}
