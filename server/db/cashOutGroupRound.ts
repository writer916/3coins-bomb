import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export interface GroupCashOutView {
  readonly groupId: string
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly participantCompleted: boolean
}
export type CashOutGroupRoundResult =
  | { readonly status: 'cashed_out' | 'retry'; readonly view: GroupCashOutView }
  | { readonly status: 'unavailable' | 'conflict' }
interface Row extends Record<string, unknown> {
  status: 'cashed_out' | 'retry' | 'unavailable' | 'conflict'
  group_id: string | null; round_number: number | null; captured_coins: number | null
  opened_bag_count: number | null; participant_completed: boolean | null
}

/** Participant row lock serializes CASH OUT with GROUP OPEN in one atomic statement. */
export async function persistGroupRoundCashOut(input: { groupId: string; participantTokenHash: string; requestId: string }): Promise<CashOutGroupRoundResult> {
  const result = await getDatabase().execute<Row>(sql`
    with candidate as materialized (
      select participant.id participant_id, participant.group_id, participant.completed_at, match.total_rounds
      from group_participants participant
      inner join group_matches match on match.id = participant.group_id
      where participant.group_id = ${input.groupId}::uuid
        and participant.auth_token_hash = ${input.participantTokenHash}
        and participant.excluded_at is null
        and match.status = 'open'
      for update of participant
    ), exact_retry as materialized (
      select attempt.*, candidate.total_rounds
      from group_round_attempts attempt
      inner join candidate on candidate.group_id = attempt.group_id and candidate.participant_id = attempt.participant_id
      where attempt.terminal_request_id = ${input.requestId}::uuid
        and attempt.status = 'cashed_out'
    ), target as materialized (
      select candidate.*, attempt.round_number, attempt.opened_bag_count, placement.coin_bag_numbers, placement.bomb_bag_number
      from candidate
      inner join group_round_attempts attempt on attempt.group_id = candidate.group_id and attempt.participant_id = candidate.participant_id and attempt.status = 'active'
      inner join group_round_placements placement on placement.group_id = attempt.group_id and placement.round_number = attempt.round_number
      where candidate.completed_at is null
    ), summary as materialized (
      select target.participant_id, target.group_id, target.total_rounds, target.round_number,
        count(distinct opened.open_order)::smallint opened_bag_count,
        min(opened.open_order)::smallint first_open_order,
        max(opened.open_order)::smallint last_open_order,
        count(coin_bag)::smallint provisional_coins,
        coalesce(bool_or(opened.bag_number = target.bomb_bag_number), false) bomb_opened
      from target
      left join group_round_opens opened on opened.group_id = target.group_id and opened.participant_id = target.participant_id and opened.round_number = target.round_number
      left join lateral unnest(target.coin_bag_numbers) coin_bag on coin_bag = opened.bag_number
      group by target.participant_id, target.group_id, target.total_rounds, target.round_number
    ), updated_attempt as (
      update group_round_attempts attempt set
        status = 'cashed_out', captured_coins = summary.provisional_coins,
        opened_bag_count = summary.opened_bag_count, ended_at = statement_timestamp(),
        terminal_request_id = ${input.requestId}::uuid, version = attempt.version + 1
      from summary
      where attempt.group_id = summary.group_id and attempt.participant_id = summary.participant_id
        and attempt.round_number = summary.round_number and attempt.status = 'active'
        and summary.provisional_coins in (1, 2) and not summary.bomb_opened
        and summary.opened_bag_count > 0 and summary.first_open_order = 1
        and summary.last_open_order = summary.opened_bag_count
        and not exists(select 1 from exact_retry)
      returning attempt.*
    ), completed_participant as (
      update group_participants participant set completed_at = statement_timestamp(), version = participant.version + 1
      from updated_attempt updated, candidate
      where participant.id = updated.participant_id and participant.group_id = updated.group_id
        and updated.round_number = candidate.total_rounds and participant.completed_at is null and participant.excluded_at is null
      returning participant.id
    ), response as materialized (
      select 'cashed_out'::text status, updated.group_id, updated.round_number, updated.captured_coins,
        updated.opened_bag_count, (updated.round_number = candidate.total_rounds) participant_completed
      from updated_attempt updated inner join candidate on candidate.group_id = updated.group_id and candidate.participant_id = updated.participant_id
      union all
      select 'retry'::text, retry.group_id, retry.round_number, retry.captured_coins,
        retry.opened_bag_count, (retry.round_number = retry.total_rounds)
      from exact_retry retry
    )
    select * from response
    union all
    select case when exists(select 1 from candidate) then 'conflict' else 'unavailable' end,
      null, null, null, null, null
    where not exists(select 1 from response)
  `)
  const row = result.rows[0]!
  if (row.status === 'unavailable' || row.status === 'conflict') return { status: row.status }
  if (row.group_id === null || row.round_number === null || (row.captured_coins !== 1 && row.captured_coins !== 2) || row.opened_bag_count === null || row.participant_completed === null) throw new Error('GROUP CASH OUT response is inconsistent.')
  return { status: row.status, view: { groupId: row.group_id, roundNumber: row.round_number, endReason: 'cashed_out', capturedCoins: row.captured_coins, openedBagCount: row.opened_bag_count, participantCompleted: row.participant_completed } }
}
