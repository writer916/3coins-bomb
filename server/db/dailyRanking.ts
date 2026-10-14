/**
 * Loads finished DAILY participants + attempts for ranking snapshots.
 * Read-only — no timeout / expiry side effects. No schema changes.
 */
import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import type {
  DailyRankingCandidate,
  DailyRankingWindow,
} from '../../src/daily/dailyRanking.js'
import { getDatabase } from './client.js'
import {
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultParticipantRow,
} from './dailyResult.js'

interface ParticipantLoadRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly display_nickname: string
  readonly accepted_at: Date | string
  readonly completed_at: Date | string
  readonly expired_at: Date | string | null
}

interface AttemptLoadRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly round_number: number
  readonly status: string
  readonly elapsed_seconds: number | null
  readonly captured_coins: number | null
  readonly opened_bag_count: number
  readonly coin_bag_hits: number | null
}

function asIso(value: Date | string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('DAILY ranking timestamp is inconsistent.')
  }
  return date.toISOString()
}

function mapParticipant(row: ParticipantLoadRow): DailyResultParticipantRow {
  return {
    participantId: row.participant_id,
    challengeDate: row.challenge_date,
    displayNickname: row.display_nickname,
    acceptedAt: asIso(row.accepted_at),
    completedAt: asIso(row.completed_at),
    expiredAt: row.expired_at === null ? null : asIso(row.expired_at),
  }
}

function mapAttempt(row: AttemptLoadRow): DailyAttemptResultRow {
  return {
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
  }
}

/**
 * Builds ranking candidates from already-loaded participant/attempt rows.
 * Skips participants that fail finished-score validation (corrupt / incomplete).
 */
export function buildDailyRankingCandidates(
  participants: readonly DailyResultParticipantRow[],
  attempts: readonly DailyAttemptResultRow[],
): readonly DailyRankingCandidate[] {
  const byParticipant = new Map<string, DailyAttemptResultRow[]>()
  for (const attempt of attempts) {
    const list = byParticipant.get(attempt.participantId)
    if (list) list.push(attempt)
    else byParticipant.set(attempt.participantId, [attempt])
  }

  const candidates: DailyRankingCandidate[] = []
  for (const participant of participants) {
    if (participant.completedAt === null || participant.expiredAt !== null) {
      continue
    }
    const summary = tryBuildDailyParticipantResultSummary(
      participant,
      byParticipant.get(participant.participantId) ?? [],
    )
    if (!summary) continue
    candidates.push({
      summary,
      completedAt: participant.completedAt,
    })
  }
  return candidates
}

/**
 * Loads completed (non-expired) participants for a challenge date, optionally
 * capped by the provisional rankingAsOf inclusive upper bound.
 *
 * Uses existing `daily_participants_ranking_idx` — no migration.
 */
export async function loadDailyRankingPool(input: {
  readonly challengeDate: DailyChallengeDate
  readonly window: DailyRankingWindow
}): Promise<readonly DailyRankingCandidate[]> {
  const participantResult =
    input.window.status === 'final'
      ? await getDatabase().execute<ParticipantLoadRow>(sql`
          select
            participant.id as participant_id,
            participant.challenge_date,
            participant.display_nickname,
            participant.accepted_at,
            participant.completed_at,
            participant.expired_at
          from daily_challenge_participants participant
          where participant.challenge_date = ${input.challengeDate}::date
            and participant.completed_at is not null
            and participant.expired_at is null
        `)
      : await getDatabase().execute<ParticipantLoadRow>(sql`
          select
            participant.id as participant_id,
            participant.challenge_date,
            participant.display_nickname,
            participant.accepted_at,
            participant.completed_at,
            participant.expired_at
          from daily_challenge_participants participant
          where participant.challenge_date = ${input.challengeDate}::date
            and participant.completed_at is not null
            and participant.expired_at is null
            and participant.completed_at <= ${input.window.rankingAsOf}::timestamptz
        `)

  const participants = participantResult.rows.map(mapParticipant)
  if (participants.length === 0) return []

  const ids = participants.map((row) => row.participantId)
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
      and attempt.participant_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    order by attempt.participant_id asc, attempt.round_number asc
  `)

  return buildDailyRankingCandidates(participants, attemptResult.rows.map(mapAttempt))
}
