import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import {
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import { validateDailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { dailyElapsedSecondsAtTap } from '../../src/daily/dailyTime.js'
import {
  openDailyBag,
  type DailyOpenView,
  type OpenDailyBagResult,
} from '../db/openDailyBag.js'

export const DAILY_OPEN_BODY_MAX_BYTES = 256

export class DailyOpenApiError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'UNAVAILABLE' | 'CONFLICT'

  constructor(code: DailyOpenApiError['code']) {
    super('The DAILY OPEN request could not be completed.')
    this.name = 'DailyOpenApiError'
    this.code = code
  }
}

export interface DailyOpenRequest {
  readonly challengeDate: string
  readonly authTokenHash: string
  readonly requestId: string
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
}

/** HTTP-safe OPEN result — never includes placements or participant id. */
export interface DailyOpenApiResponse {
  readonly challengeDate: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly remainingSecondsAtTap: number
  readonly outcome: DailyOpenView['outcome']
  readonly coinsFound: DailyOpenView['coinsFound']
  readonly provisionalCoins: DailyOpenView['provisionalCoins']
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: DailyOpenView['endReason']
  readonly capturedCoins: DailyOpenView['capturedCoins']
  readonly elapsedSeconds: number | null
  readonly coinBagHits: number | null
  readonly participantCompleted: boolean
}

export function toDailyOpenApiResponse(view: DailyOpenView): DailyOpenApiResponse {
  return {
    challengeDate: view.challengeDate,
    roundNumber: view.roundNumber,
    bagNumber: view.bagNumber,
    openOrder: view.openOrder,
    remainingSecondsAtTap: view.remainingSecondsAtTap,
    outcome: view.outcome,
    coinsFound: view.coinsFound,
    provisionalCoins: view.provisionalCoins,
    openedBagCount: view.openedBagCount,
    roundEnded: view.roundEnded,
    endReason: view.endReason,
    capturedCoins: view.capturedCoins,
    elapsedSeconds: view.elapsedSeconds,
    coinBagHits: view.coinBagHits,
    participantCompleted: view.participantCompleted,
  }
}

export function validateDailyOpenRequest(
  dateValue: unknown,
  authorization: unknown,
  requestIdValue: unknown,
  body: unknown,
): DailyOpenRequest {
  let challengeDate: string
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 2 ||
    !('bagNumber' in record) ||
    !('remainingSecondsAtTap' in record)
  ) {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
  if (
    !Number.isInteger(record.bagNumber) ||
    (record.bagNumber as number) < 1 ||
    (record.bagNumber as number) > 8
  ) {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
  try {
    dailyElapsedSecondsAtTap(record.remainingSecondsAtTap)
  } catch {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }

  let authTokenHash: string
  try {
    const token = validateDailyParticipantCapability(
      parseBearerToken(authorization),
    )
    authTokenHash = hashDailyParticipantCapability(token)
  } catch {
    throw new DailyOpenApiError('UNAUTHORIZED')
  }

  try {
    return {
      challengeDate,
      authTokenHash,
      requestId: validateCreateRequestId(requestIdValue),
      bagNumber: record.bagNumber as number,
      remainingSecondsAtTap: record.remainingSecondsAtTap as number,
    }
  } catch {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
}

export async function openDailyChallengeBag(
  request: DailyOpenRequest,
  persist: (input: {
    readonly challengeDate: string
    readonly authTokenHash: string
    readonly requestId: string
    readonly bagNumber: number
    readonly remainingSecondsAtTap: number
  }) => Promise<OpenDailyBagResult> = openDailyBag,
): Promise<DailyOpenApiResponse> {
  const result = await persist({
    challengeDate: request.challengeDate,
    authTokenHash: request.authTokenHash,
    requestId: request.requestId,
    bagNumber: request.bagNumber,
    remainingSecondsAtTap: request.remainingSecondsAtTap,
  })
  if (result.status === 'opened' || result.status === 'retry') {
    return toDailyOpenApiResponse(result.view)
  }
  throw new DailyOpenApiError(
    result.status === 'unavailable' ? 'UNAVAILABLE' : 'CONFLICT',
  )
}
