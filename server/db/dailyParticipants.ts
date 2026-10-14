import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import { getDatabase } from './client.js'

export interface PersistDailyParticipantInput {
  readonly challengeDate: DailyChallengeDate
  readonly displayNickname: string
  readonly nicknameKey: string
  readonly authTokenHash: string
  readonly joinRequestId: string
  readonly questionOrder: readonly number[]
}

export interface DailyParticipantRecord {
  readonly participantId: string
  readonly challengeDate: DailyChallengeDate
  readonly displayNickname: string
  readonly questionOrder: readonly number[]
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

interface ParticipantRow extends Record<string, unknown> {
  readonly participant_id: string
  readonly challenge_date: string
  readonly display_nickname: string
  readonly question_order: number[]
  readonly accepted_at: Date | string
  readonly completed_at: Date | string | null
  readonly expired_at: Date | string | null
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function participant(row: ParticipantRow): DailyParticipantRecord {
  return {
    participantId: row.participant_id,
    challengeDate: row.challenge_date,
    displayNickname: row.display_nickname,
    questionOrder: row.question_order.map(Number),
    acceptedAt: new Date(row.accepted_at).toISOString(),
    completedAt: optionalIso(row.completed_at),
    expiredAt: optionalIso(row.expired_at),
  }
}

/**
 * One atomic statement verifies the complete question set and inserts the JOIN.
 * A request-id conflict returns the original immutable participant fields.
 */
export async function persistDailyParticipant(
  input: PersistDailyParticipantInput,
): Promise<DailyParticipantRecord | null> {
  const result = await getDatabase().execute<ParticipantRow>(sql`
    with challenge as materialized (
      select challenge.challenge_date
      from daily_challenges challenge
      inner join daily_challenge_placements placement
        on placement.challenge_date = challenge.challenge_date
      where challenge.challenge_date = ${input.challengeDate}::date
      group by challenge.challenge_date
      having count(placement.round_number) = ${DAILY_CHALLENGE_ROUNDS}
    ), persisted as (
      insert into daily_challenge_participants (
        challenge_date,
        display_nickname,
        nickname_key,
        auth_token_hash,
        join_request_id,
        question_order
      )
      select
        challenge.challenge_date,
        ${input.displayNickname},
        ${input.nicknameKey},
        ${input.authTokenHash},
        ${input.joinRequestId}::uuid,
        ${sql.param(input.questionOrder)}::smallint[]
      from challenge
      on conflict (join_request_id) do update
      set join_request_id = excluded.join_request_id
      where daily_challenge_participants.challenge_date = excluded.challenge_date
        and daily_challenge_participants.auth_token_hash = excluded.auth_token_hash
      returning
        id as participant_id,
        challenge_date,
        display_nickname,
        question_order,
        accepted_at,
        completed_at,
        expired_at
    )
    select * from persisted
  `)
  const row = result.rows[0]
  return row ? participant(row) : null
}

/** Token hashes are accepted only together with their UTC challenge date. */
export async function loadDailyParticipantByToken(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}): Promise<DailyParticipantRecord | null> {
  const result = await getDatabase().execute<ParticipantRow>(sql`
    select
      participant.id as participant_id,
      participant.challenge_date,
      participant.display_nickname,
      participant.question_order,
      participant.accepted_at,
      participant.completed_at,
      participant.expired_at
    from daily_challenge_participants participant
    where participant.challenge_date = ${input.challengeDate}::date
      and participant.auth_token_hash = ${input.authTokenHash}
    limit 1
  `)
  const row = result.rows[0]
  return row ? participant(row) : null
}
