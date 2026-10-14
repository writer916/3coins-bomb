import { parseBearerToken } from '../auth/duelTokens.js'
import {
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import {
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from '../../src/daily/dailyChallengeDate.js'
import type { DailyParticipantResultSummary } from '../../src/daily/dailyResult.js'
import type { DailyResultDetailRoundView } from '../../src/daily/dailyResultDetail.js'
import type { DailyPlayPlacement } from '../../src/daily/dailyLocalOpen.js'
import {
  loadDailyResultDetailSource,
  tryAssembleDailyResultDetailRounds,
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultOpenLoadRow,
  type DailyResultParticipantRow,
} from '../db/dailyResult.js'

export class DailyResultApiError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'UNAVAILABLE'

  constructor(code: DailyResultApiError['code']) {
    super('The DAILY result request could not be completed.')
    this.name = 'DailyResultApiError'
    this.code = code
  }
}

export interface DailyResultAuth {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}

export interface DailyResultDetailOpenResponse {
  readonly order: number
  readonly bagNumber: number
  readonly kind: 'empty' | 'coins' | 'bomb'
  readonly coinCount: 0 | 1 | 2 | 3
}

export interface DailyResultRoundResponse {
  readonly roundNumber: number
  readonly endReason: 'bombed' | 'cashed_out' | 'cleared' | 'timed_out'
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly elapsedSeconds: number
  /** Board fields (eng9D) — always present for finished self RESULT. */
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
  readonly opens: readonly DailyResultDetailOpenResponse[]
}

/** Self RESULT only — never includes tokens or other participants. */
export interface DailyResultResponse {
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
  readonly totalTimeSeconds: number
  readonly rounds: readonly DailyResultRoundResponse[]
}

export type LoadDailyResultDetailSource = (input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}) => Promise<{
  readonly participant: DailyResultParticipantRow
  readonly attempts: readonly DailyAttemptResultRow[]
  readonly opens: readonly DailyResultOpenLoadRow[]
  readonly placements: readonly DailyPlayPlacement[]
} | null>

export type BuildDailyResultSummary = (
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
) => DailyParticipantResultSummary | null

export type AssembleDailyResultDetail = (
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
  opens: readonly DailyResultOpenLoadRow[],
  placements: readonly DailyPlayPlacement[],
  summary: DailyParticipantResultSummary,
) => readonly DailyResultDetailRoundView[] | null

export interface DailyResultApiDependencies {
  readonly loadDetailSource?: LoadDailyResultDetailSource
  readonly buildSummary?: BuildDailyResultSummary
  readonly assembleDetail?: AssembleDailyResultDetail
}

export function toDailyResultResponse(
  summary: DailyParticipantResultSummary,
  completedAt: string,
  detailRounds: readonly DailyResultDetailRoundView[],
): DailyResultResponse {
  if (detailRounds.length !== summary.rounds.length) {
    throw new DailyResultApiError('UNAVAILABLE')
  }
  return {
    challengeDate: summary.challengeDate,
    participantId: summary.participantId,
    nickname: summary.displayNickname,
    acceptedAt: summary.acceptedAt,
    completedAt,
    totalCoins: summary.totalCoins,
    threeCoinsComplete: summary.threeCoinsComplete,
    coinBagHits: summary.coinBagHits,
    totalOpens: summary.totalOpens,
    coinBagHitRate: {
      numerator: summary.coinBagHitRate.numerator,
      denominator: summary.coinBagHitRate.denominator,
    },
    totalTimeSeconds: summary.totalTimeSeconds,
    rounds: detailRounds.map((round) => ({
      roundNumber: round.roundNumber,
      endReason: round.endReason,
      capturedCoins: round.capturedCoins,
      openedBagCount: round.openedBagCount,
      coinBagHits: round.coinBagHits,
      elapsedSeconds: round.elapsedSeconds,
      bagCount: round.bagCount,
      bombBagNumber: round.bombBagNumber,
      coinBagNumbers: round.coinBagNumbers,
      opens: round.opens.map((opened) => ({
        order: opened.order,
        bagNumber: opened.bagNumber,
        kind: opened.kind,
        coinCount: opened.coinCount,
      })),
    })),
  }
}

export function validateDailyResultAuth(
  dateValue: unknown,
  authorization: unknown,
): DailyResultAuth {
  let challengeDate: DailyChallengeDate
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyResultApiError('INVALID_REQUEST')
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
    throw new DailyResultApiError('UNAUTHORIZED')
  }
}

/**
 * Returns the authenticated finished RESULT with placement boards.
 * Missing / incomplete / expired / corrupt / join failure → UNAVAILABLE (404).
 */
export async function readDailyResult(
  auth: DailyResultAuth,
  dependencies: DailyResultApiDependencies = {},
): Promise<DailyResultResponse> {
  const load = dependencies.loadDetailSource ?? loadDailyResultDetailSource
  const build = dependencies.buildSummary ?? tryBuildDailyParticipantResultSummary
  const assemble = dependencies.assembleDetail ?? tryAssembleDailyResultDetailRounds

  const source = await load({
    challengeDate: auth.challengeDate,
    authTokenHash: auth.authTokenHash,
  })
  if (!source) throw new DailyResultApiError('UNAVAILABLE')
  if (source.participant.challengeDate !== auth.challengeDate) {
    throw new DailyResultApiError('UNAVAILABLE')
  }
  if (source.participant.completedAt === null) {
    throw new DailyResultApiError('UNAVAILABLE')
  }
  if (source.participant.expiredAt !== null) {
    throw new DailyResultApiError('UNAVAILABLE')
  }

  const summary = build(source.participant, source.attempts)
  if (!summary || summary.challengeDate !== auth.challengeDate) {
    throw new DailyResultApiError('UNAVAILABLE')
  }

  const detailRounds = assemble(
    source.participant,
    source.attempts,
    source.opens,
    source.placements,
    summary,
  )
  if (!detailRounds) throw new DailyResultApiError('UNAVAILABLE')

  return toDailyResultResponse(
    summary,
    source.participant.completedAt,
    detailRounds,
  )
}
