/**
 * Maps persisted DAILY attempt rows into RESULT summaries.
 * No database I/O here — callers supply already-loaded rows.
 */
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import {
  DailyResultValidationError,
  aggregateDailyParticipantResult,
  tryAggregateDailyParticipantResult,
  type DailyParticipantResultSummary,
  type DailyRoundResultInput,
  type DailyTerminalEndReason,
} from '../../src/daily/dailyResult.js'

export interface DailyAttemptResultRow {
  readonly participantId: string
  readonly challengeDate: string
  readonly roundNumber: number
  readonly status: string
  readonly elapsedSeconds: number | null
  readonly capturedCoins: number | null
  readonly openedBagCount: number
  readonly coinBagHits: number | null
}

export interface DailyResultParticipantRow {
  readonly participantId: string
  readonly challengeDate: string
  readonly displayNickname: string
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

const TERMINAL: ReadonlySet<string> = new Set([
  'bombed',
  'cashed_out',
  'cleared',
  'timed_out',
])

/**
 * Converts one terminal attempt row into a round input.
 * Active / incomplete rows return null (not a finished ROUND).
 */
export function dailyAttemptRowToRoundInput(
  row: DailyAttemptResultRow,
): DailyRoundResultInput | null {
  if (!TERMINAL.has(row.status)) return null
  if (
    row.elapsedSeconds === null ||
    row.capturedCoins === null ||
    row.coinBagHits === null
  ) {
    return null
  }
  return {
    roundNumber: row.roundNumber,
    endReason: row.status as DailyTerminalEndReason,
    capturedCoins: row.capturedCoins,
    openedBagCount: row.openedBagCount,
    coinBagHits: row.coinBagHits,
    elapsedSeconds: row.elapsedSeconds,
  }
}

function mapTerminalRounds(
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
): DailyRoundResultInput[] | null {
  if (attempts.length !== DAILY_CHALLENGE_ROUNDS) return null
  const rounds: DailyRoundResultInput[] = []
  for (const attempt of attempts) {
    if (attempt.participantId !== participant.participantId) return null
    if (attempt.challengeDate !== participant.challengeDate) return null
    const round = dailyAttemptRowToRoundInput(attempt)
    if (!round) return null
    rounds.push(round)
  }
  return rounds
}

/**
 * Finished-score gate: participant must be completed (not expired), with
 * exactly 20 terminal attempts. Incomplete / mid-run / expired runs return null.
 */
export function tryBuildDailyParticipantResultSummary(
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
): DailyParticipantResultSummary | null {
  if (participant.completedAt === null || participant.expiredAt !== null) {
    return null
  }
  const rounds = mapTerminalRounds(participant, attempts)
  if (!rounds) return null
  return tryAggregateDailyParticipantResult({
    participantId: participant.participantId,
    displayNickname: participant.displayNickname,
    challengeDate: participant.challengeDate,
    acceptedAt: participant.acceptedAt,
    rounds,
  })
}

/**
 * Strict builder for finished participants. Incomplete runs throw
 * `DailyResultValidationError` with code `incomplete_rounds`.
 */
export function buildDailyParticipantResultSummary(
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
): DailyParticipantResultSummary {
  if (participant.completedAt === null || participant.expiredAt !== null) {
    throw new DailyResultValidationError('incomplete_rounds')
  }
  const rounds = mapTerminalRounds(participant, attempts)
  if (!rounds) throw new DailyResultValidationError('incomplete_rounds')
  return aggregateDailyParticipantResult({
    participantId: participant.participantId,
    displayNickname: participant.displayNickname,
    challengeDate: participant.challengeDate,
    acceptedAt: participant.acceptedAt,
    rounds,
  })
}
