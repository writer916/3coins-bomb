/**
 * Maps persisted DAILY attempt rows into RESULT summaries, and loads them
 * by authenticated participant capability (challenge date + token hash).
 */
import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import {
  DailyResultValidationError,
  aggregateDailyParticipantResult,
  tryAggregateDailyParticipantResult,
  type DailyParticipantResultSummary,
  type DailyRoundResultInput,
  type DailyTerminalEndReason,
} from '../../src/daily/dailyResult.js'
import { getDatabase } from './client.js'
import { getDailyPlacementsForParticipant } from './dailyPlacements.js'
import type { DailyPlayPlacement } from '../../src/daily/dailyLocalOpen.js'
import { tryBuildDailyResultDetailRounds } from '../../src/daily/dailyResultDetail.js'
import type { DailyResultDetailRoundView } from '../../src/daily/dailyResultDetail.js'

export interface DailyAttemptResultRow {
  readonly participantId: string
  readonly challengeDate: string
  readonly roundNumber: number
  readonly status: string
  readonly elapsedSeconds: number | null
  readonly capturedCoins: number | null
  readonly openedBagCount: number
  readonly coinBagHits: number | null
  /** Present on detail loads — challenge-set ROUND mapped via question_order. */
  readonly challengeRoundNumber?: number
}

export interface DailyResultParticipantRow {
  readonly participantId: string
  readonly challengeDate: string
  readonly displayNickname: string
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
  /** Present on detail loads — permutation of challenge-set ROUND numbers. */
  readonly questionOrder?: readonly number[]
}

export interface DailyResultOpenLoadRow {
  readonly participantId: string
  readonly challengeDate: string
  readonly roundNumber: number
  readonly openOrder: number
  readonly bagNumber: number
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

interface ParticipantLoadRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly display_nickname: string
  readonly accepted_at: Date | string
  readonly completed_at: Date | string | null
  readonly expired_at: Date | string | null
  readonly question_order?: number[]
}

interface AttemptLoadRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly round_number: number
  readonly challenge_round_number?: number
  readonly status: string
  readonly elapsed_seconds: number | null
  readonly captured_coins: number | null
  readonly opened_bag_count: number
  readonly coin_bag_hits: number | null
}

interface OpenLoadRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly round_number: number
  readonly open_order: number
  readonly bag_number: number
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function asIso(value: Date | string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('DAILY result timestamp is inconsistent.')
  }
  return date.toISOString()
}

/**
 * Loads the authenticated participant and their attempts for one challenge date.
 * Returns null when the capability does not match a participant on that date.
 * Read-only — no timeout / expiry side effects.
 */
export async function loadDailyResultSource(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}): Promise<{
  readonly participant: DailyResultParticipantRow
  readonly attempts: readonly DailyAttemptResultRow[]
} | null> {
  const participantResult = await getDatabase().execute<ParticipantLoadRow>(sql`
    select
      participant.id as participant_id,
      participant.challenge_date,
      participant.display_nickname,
      participant.accepted_at,
      participant.completed_at,
      participant.expired_at
    from daily_challenge_participants participant
    where participant.challenge_date = ${input.challengeDate}::date
      and participant.auth_token_hash = ${input.authTokenHash}
    limit 1
  `)
  const participantRow = participantResult.rows[0]
  if (!participantRow) return null

  const participant: DailyResultParticipantRow = {
    participantId: participantRow.participant_id,
    challengeDate: participantRow.challenge_date,
    displayNickname: participantRow.display_nickname,
    acceptedAt: asIso(participantRow.accepted_at),
    completedAt: optionalIso(participantRow.completed_at),
    expiredAt: optionalIso(participantRow.expired_at),
  }

  const attemptResult = await getDatabase().execute<AttemptLoadRow>(sql`
    select
      attempt.participant_id,
      attempt.challenge_date,
      attempt.round_number,
      attempt.status,
      attempt.elapsed_seconds,
      attempt.captured_coins,
      attempt.opened_bag_count,
      attempt.coin_bag_hits
    from daily_challenge_round_attempts attempt
    where attempt.challenge_date = ${input.challengeDate}::date
      and attempt.participant_id = ${participant.participantId}::uuid
    order by attempt.round_number asc
  `)

  const attempts: DailyAttemptResultRow[] = attemptResult.rows.map((row) => ({
    participantId: row.participant_id,
    challengeDate: row.challenge_date,
    roundNumber: Number(row.round_number),
    status: row.status,
    elapsedSeconds:
      row.elapsed_seconds === null ? null : Number(row.elapsed_seconds),
    capturedCoins:
      row.captured_coins === null ? null : Number(row.captured_coins),
    openedBagCount: Number(row.opened_bag_count),
    coinBagHits: row.coin_bag_hits === null ? null : Number(row.coin_bag_hits),
  }))

  return { participant, attempts }
}

/**
 * Auth-scoped finished RESULT. Null when missing, incomplete, expired, or corrupt.
 */
export async function loadDailyParticipantResultSummary(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}): Promise<DailyParticipantResultSummary | null> {
  const source = await loadDailyResultSource(input)
  if (!source) return null
  return tryBuildDailyParticipantResultSummary(source.participant, source.attempts)
}

/**
 * Finished RESULT plus play-order placements and OPEN history for the board.
 * Null when capability miss, incomplete, or placement/OPEN join is inconsistent.
 */
export async function loadDailyResultDetailSource(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}): Promise<{
  readonly participant: DailyResultParticipantRow
  readonly attempts: readonly DailyAttemptResultRow[]
  readonly opens: readonly DailyResultOpenLoadRow[]
  readonly placements: readonly DailyPlayPlacement[]
} | null> {
  const participantResult = await getDatabase().execute<ParticipantLoadRow>(sql`
    select
      participant.id as participant_id,
      participant.challenge_date,
      participant.display_nickname,
      participant.accepted_at,
      participant.completed_at,
      participant.expired_at,
      participant.question_order
    from daily_challenge_participants participant
    where participant.challenge_date = ${input.challengeDate}::date
      and participant.auth_token_hash = ${input.authTokenHash}
    limit 1
  `)
  const participantRow = participantResult.rows[0]
  if (!participantRow) return null
  if (
    !Array.isArray(participantRow.question_order) ||
    participantRow.question_order.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    return null
  }

  const participant: DailyResultParticipantRow = {
    participantId: participantRow.participant_id,
    challengeDate: participantRow.challenge_date,
    displayNickname: participantRow.display_nickname,
    acceptedAt: asIso(participantRow.accepted_at),
    completedAt: optionalIso(participantRow.completed_at),
    expiredAt: optionalIso(participantRow.expired_at),
    questionOrder: participantRow.question_order.map(Number),
  }

  const attemptResult = await getDatabase().execute<AttemptLoadRow>(sql`
    select
      attempt.participant_id,
      attempt.challenge_date,
      attempt.round_number,
      attempt.challenge_round_number,
      attempt.status,
      attempt.elapsed_seconds,
      attempt.captured_coins,
      attempt.opened_bag_count,
      attempt.coin_bag_hits
    from daily_challenge_round_attempts attempt
    where attempt.challenge_date = ${input.challengeDate}::date
      and attempt.participant_id = ${participant.participantId}::uuid
    order by attempt.round_number asc
  `)

  const attempts: DailyAttemptResultRow[] = attemptResult.rows.map((row) => ({
    participantId: row.participant_id,
    challengeDate: row.challenge_date,
    roundNumber: Number(row.round_number),
    challengeRoundNumber: Number(row.challenge_round_number),
    status: row.status,
    elapsedSeconds:
      row.elapsed_seconds === null ? null : Number(row.elapsed_seconds),
    capturedCoins:
      row.captured_coins === null ? null : Number(row.captured_coins),
    openedBagCount: Number(row.opened_bag_count),
    coinBagHits: row.coin_bag_hits === null ? null : Number(row.coin_bag_hits),
  }))

  const openResult = await getDatabase().execute<OpenLoadRow>(sql`
    select
      opened.participant_id,
      opened.challenge_date,
      opened.round_number,
      opened.open_order,
      opened.bag_number
    from daily_challenge_round_opens opened
    where opened.challenge_date = ${input.challengeDate}::date
      and opened.participant_id = ${participant.participantId}::uuid
    order by opened.round_number asc, opened.open_order asc
  `)

  const opens: DailyResultOpenLoadRow[] = openResult.rows.map((row) => ({
    participantId: row.participant_id,
    challengeDate: row.challenge_date,
    roundNumber: Number(row.round_number),
    openOrder: Number(row.open_order),
    bagNumber: Number(row.bag_number),
  }))

  const placementSet = await getDailyPlacementsForParticipant(input)
  if (!placementSet || placementSet.challengeDate !== input.challengeDate) {
    return null
  }

  return {
    participant,
    attempts,
    opens,
    placements: placementSet.placements,
  }
}

/**
 * Assembles board rounds from an already-loaded detail source + score summary.
 * Null when question_order / placement / OPEN join fails validation.
 */
export function tryAssembleDailyResultDetailRounds(
  participant: DailyResultParticipantRow,
  attempts: readonly DailyAttemptResultRow[],
  opens: readonly DailyResultOpenLoadRow[],
  placements: readonly DailyPlayPlacement[],
  summary: DailyParticipantResultSummary,
): readonly DailyResultDetailRoundView[] | null {
  if (
    !participant.questionOrder ||
    participant.questionOrder.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    return null
  }
  const orderChecks = attempts.map((attempt) => {
    if (typeof attempt.challengeRoundNumber !== 'number') return null
    return {
      roundNumber: attempt.roundNumber,
      challengeRoundNumber: attempt.challengeRoundNumber,
      openedBagCount: attempt.openedBagCount,
    }
  })
  if (orderChecks.some((entry) => entry === null)) return null
  return tryBuildDailyResultDetailRounds({
    rounds: summary.rounds,
    placements,
    opens,
    attempts: orderChecks as {
      roundNumber: number
      challengeRoundNumber: number
      openedBagCount: number
    }[],
    questionOrder: participant.questionOrder,
  })
}
