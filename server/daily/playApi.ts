import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import {
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../auth/dailyTokens.js'
import { validateDailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import {
  getDailyPlayState,
  startDailyRound,
  type PersistedDailyPlayState,
  type StartDailyRoundResult,
} from '../db/dailyPlay.js'

export class DailyPlayApiError extends Error {
  readonly code:
    | 'INVALID_REQUEST'
    | 'UNAUTHORIZED'
    | 'NOT_FOUND'
    | 'CANNOT_START'
    | 'CHALLENGE_ENDED'
    | 'ALREADY_ACTIVE'
    | 'COMPLETED'

  constructor(code: DailyPlayApiError['code']) {
    super('The DAILY play request could not be completed.')
    this.name = 'DailyPlayApiError'
    this.code = code
  }
}

export interface DailyPlayAuth {
  readonly challengeDate: string
  readonly authTokenHash: string
}

export interface DailyPlayCommand extends DailyPlayAuth {
  readonly startRequestId: string
}

export interface DailyPlayOpenView {
  readonly openOrder: number
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
  readonly openedAt: string
  readonly outcome: 'empty' | 'coins' | 'bomb'
  readonly coinsFound: 0 | 1 | 2 | 3
}

export interface DailyPlayActiveAttemptView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly startedAt: string
  readonly deadlineAt: string
  readonly openedBagCount: number
  readonly opens: readonly DailyPlayOpenView[]
}

export interface DailyPlayTerminalAttemptView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly endReason: 'bombed' | 'cashed_out' | 'cleared' | 'timed_out'
  readonly endedAt: string
  readonly elapsedSeconds: number
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly opens: readonly DailyPlayOpenView[]
}

/** Safe play DTO — no bomb/coin placements, no other participants. */
export interface DailyPlayResponse {
  readonly challengeDate: string
  readonly serverNow: string
  readonly challengeEndsAt: string
  readonly completedRounds: number
  readonly nextRoundNumber: number | null
  readonly activeAttempt: DailyPlayActiveAttemptView | null
  readonly latestTerminalAttempt: DailyPlayTerminalAttemptView | null
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

export interface DailyPlayApiDependencies {
  readonly getState?: typeof getDailyPlayState
  readonly start?: typeof startDailyRound
}

export function toDailyPlayResponse(
  state: PersistedDailyPlayState,
): DailyPlayResponse {
  return {
    challengeDate: state.challengeDate,
    serverNow: state.serverNow,
    challengeEndsAt: state.challengeEndsAt,
    completedRounds: state.completedRounds,
    nextRoundNumber: state.nextRoundNumber,
    completedAt: state.completedAt,
    expiredAt: state.expiredAt,
    activeAttempt: state.activeAttempt
      ? {
          roundNumber: state.activeAttempt.roundNumber,
          bagCount: state.activeAttempt.bagCount,
          startedAt: state.activeAttempt.startedAt,
          deadlineAt: state.activeAttempt.deadlineAt,
          openedBagCount: state.activeAttempt.openedBagCount,
          opens: state.activeAttempt.opens.map((open) => ({
            openOrder: open.openOrder,
            bagNumber: open.bagNumber,
            remainingSecondsAtTap: open.remainingSecondsAtTap,
            openedAt: open.openedAt,
            outcome: open.outcome,
            coinsFound: open.coinsFound,
          })),
        }
      : null,
    latestTerminalAttempt: state.latestTerminalAttempt
      ? {
          roundNumber: state.latestTerminalAttempt.roundNumber,
          bagCount: state.latestTerminalAttempt.bagCount,
          endReason: state.latestTerminalAttempt.endReason,
          endedAt: state.latestTerminalAttempt.endedAt,
          elapsedSeconds: state.latestTerminalAttempt.elapsedSeconds,
          capturedCoins: state.latestTerminalAttempt.capturedCoins,
          openedBagCount: state.latestTerminalAttempt.openedBagCount,
          coinBagHits: state.latestTerminalAttempt.coinBagHits,
          opens: state.latestTerminalAttempt.opens.map((open) => ({
            openOrder: open.openOrder,
            bagNumber: open.bagNumber,
            remainingSecondsAtTap: open.remainingSecondsAtTap,
            openedAt: open.openedAt,
            outcome: open.outcome,
            coinsFound: open.coinsFound,
          })),
        }
      : null,
  }
}

export function validateDailyPlayAuth(
  dateValue: unknown,
  authorization: unknown,
): DailyPlayAuth {
  let challengeDate: string
  try {
    challengeDate = validateDailyChallengeDate(dateValue)
  } catch {
    throw new DailyPlayApiError('INVALID_REQUEST')
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
    throw new DailyPlayApiError('UNAUTHORIZED')
  }
}

export function validateDailyPlayCommand(
  dateValue: unknown,
  authorization: unknown,
  requestIdValue: unknown,
): DailyPlayCommand {
  const auth = validateDailyPlayAuth(dateValue, authorization)
  try {
    return {
      ...auth,
      startRequestId: validateCreateRequestId(requestIdValue),
    }
  } catch {
    throw new DailyPlayApiError('INVALID_REQUEST')
  }
}

export async function readDailyPlay(
  auth: DailyPlayAuth,
  dependencies: DailyPlayApiDependencies = {},
): Promise<DailyPlayResponse> {
  const state = await (dependencies.getState ?? getDailyPlayState)({
    challengeDate: auth.challengeDate,
    authTokenHash: auth.authTokenHash,
  })
  if (!state) throw new DailyPlayApiError('NOT_FOUND')
  return toDailyPlayResponse(state)
}

function rejectStart(result: Extract<StartDailyRoundResult, { status: 'rejected' }>): never {
  switch (result.reason) {
    case 'not_found':
      throw new DailyPlayApiError('NOT_FOUND')
    case 'already_active':
      throw new DailyPlayApiError('ALREADY_ACTIVE')
    case 'completed':
    case 'rounds_exhausted':
      throw new DailyPlayApiError('COMPLETED')
    case 'expired':
    case 'challenge_ended':
      throw new DailyPlayApiError('CHALLENGE_ENDED')
    default: {
      const _exhaustive: never = result.reason
      void _exhaustive
      throw new DailyPlayApiError('CANNOT_START')
    }
  }
}

export async function beginDailyRound(
  command: DailyPlayCommand,
  dependencies: DailyPlayApiDependencies = {},
): Promise<DailyPlayResponse> {
  const result = await (dependencies.start ?? startDailyRound)({
    challengeDate: command.challengeDate,
    authTokenHash: command.authTokenHash,
    startRequestId: command.startRequestId,
  })
  if (result.status === 'started' || result.status === 'replayed') {
    return toDailyPlayResponse(result.state)
  }
  return rejectStart(result)
}
