import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import {
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import { validateDailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { dailyElapsedSecondsAtTap } from '../../src/daily/dailyTime.js'
import {
  cashOutDailyRound,
  type CashOutDailyRoundResult,
  type DailyCashOutView,
} from '../db/cashOutDailyRound.js'

export const DAILY_CASH_OUT_BODY_MAX_BYTES = 256

export class DailyCashOutApiError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'UNAVAILABLE' | 'CONFLICT'

  constructor(code: DailyCashOutApiError['code']) {
    super('The DAILY CASH OUT request could not be completed.')
    this.name = 'DailyCashOutApiError'
    this.code = code
  }
}

export interface DailyCashOutRequest {
  readonly challengeDate: string
  readonly authTokenHash: string
  readonly requestId: string
  readonly remainingSecondsAtTap: number
}

/** HTTP-safe cash-out result — never includes placements or participant id. */
export interface DailyCashOutApiResponse {
  readonly challengeDate: string
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly elapsedSeconds: number
  readonly coinBagHits: number
  readonly remainingSecondsAtTap: number
  readonly participantCompleted: boolean
}

export function toDailyCashOutApiResponse(
  view: DailyCashOutView,
): DailyCashOutApiResponse {
  return {
    challengeDate: view.challengeDate,
    roundNumber: view.roundNumber,
    endReason: view.endReason,
    capturedCoins: view.capturedCoins,
    openedBagCount: view.openedBagCount,
    elapsedSeconds: view.elapsedSeconds,
    coinBagHits: view.coinBagHits,
    remainingSecondsAtTap: view.remainingSecondsAtTap,
    participantCompleted: view.participantCompleted,
  }
}

export function validateDailyCashOutRequest(
  dateValue: unknown,
  authorization: unknown,
  requestIdValue: unknown,
  body: unknown,
): DailyCashOutRequest {
  let challengeDate: string
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyCashOutApiError('INVALID_REQUEST')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DailyCashOutApiError('INVALID_REQUEST')
  }
  const record = body as Record<string, unknown>
  if (
    Object.keys(record).length !== 1 ||
    !('remainingSecondsAtTap' in record)
  ) {
    throw new DailyCashOutApiError('INVALID_REQUEST')
  }
  try {
    dailyElapsedSecondsAtTap(record.remainingSecondsAtTap)
  } catch {
    throw new DailyCashOutApiError('INVALID_REQUEST')
  }

  let authTokenHash: string
  try {
    const token = validateDailyParticipantCapability(
      parseBearerToken(authorization),
    )
    authTokenHash = hashDailyParticipantCapability(token)
  } catch {
    throw new DailyCashOutApiError('UNAUTHORIZED')
  }

  try {
    return {
      challengeDate,
      authTokenHash,
      requestId: validateCreateRequestId(requestIdValue),
      remainingSecondsAtTap: record.remainingSecondsAtTap as number,
    }
  } catch {
    throw new DailyCashOutApiError('INVALID_REQUEST')
  }
}

export async function cashOutDailyChallengeRound(
  request: DailyCashOutRequest,
  persist: (input: {
    readonly challengeDate: string
    readonly authTokenHash: string
    readonly requestId: string
    readonly remainingSecondsAtTap: number
  }) => Promise<CashOutDailyRoundResult> = cashOutDailyRound,
): Promise<DailyCashOutApiResponse> {
  const result = await persist({
    challengeDate: request.challengeDate,
    authTokenHash: request.authTokenHash,
    requestId: request.requestId,
    remainingSecondsAtTap: request.remainingSecondsAtTap,
  })
  if (result.status === 'cashed_out' || result.status === 'retry') {
    return toDailyCashOutApiResponse(result.view)
  }
  throw new DailyCashOutApiError(
    result.status === 'unavailable' ? 'UNAVAILABLE' : 'CONFLICT',
  )
}
