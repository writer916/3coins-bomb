import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export interface CashOutDuelRoundInput {
  readonly matchId: string
  readonly participantTokenHash: string
  readonly requestId: string
  readonly roundNumber: number
}

export interface CashOutDuelRoundView {
  readonly matchId: string
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly participantCompleted: boolean
}

export type CashOutDuelRoundResult =
  | { readonly status: 'cashed_out' | 'retry'; readonly view: CashOutDuelRoundView }
  | { readonly status: 'unavailable' | 'conflict' }

interface CashOutDuelRoundRow extends Record<string, unknown> {
  readonly status: 'cashed_out' | 'retry' | 'unavailable' | 'conflict'
  readonly match_id: string | null
  readonly round_number: number | null
  readonly captured_coins: number | null
  readonly opened_bag_count: number | null
  readonly participant_completed: boolean | null
}

/**
 * Recomputes discovered coins and settles CASH OUT in one statement. The same
 * participant lock used by OPEN serializes OPEN/CASH OUT without blocking the opponent.
 */
export async function persistDuelRoundCashOut(
  input: CashOutDuelRoundInput,
): Promise<CashOutDuelRoundResult> {
  const result = await getDatabase().execute<CashOutDuelRoundRow>(sql`
    with candidate as materialized (
      select
        match.id as match_id,
        match.total_rounds,
        self.role as explorer_role,
        opponent.role as placement_role
      from duel_matches match
      inner join duel_participants self
        on self.match_id = match.id
        and self.auth_token_hash = ${input.participantTokenHash}
      inner join duel_participants opponent
        on opponent.match_id = match.id
        and opponent.role <> self.role
      where match.id = ${input.matchId}::uuid
        and self.claimed_at is not null
        and self.placement_locked_at is not null
        and opponent.claimed_at is not null
        and opponent.placement_locked_at is not null
        and (
          match.expires_at is null
          or match.expires_at > statement_timestamp()
        )
      for update of self
    ), request_result as materialized (
      select settled.*
      from duel_round_results settled
      where settled.request_id = ${input.requestId}::uuid
    ), exact_retry as materialized (
      select settled.*, candidate.total_rounds
      from request_result settled
      inner join candidate
        on candidate.match_id = settled.match_id
        and candidate.explorer_role = settled.explorer_role
        and candidate.placement_role = settled.placement_role
      where settled.round_number = ${input.roundNumber}
        and settled.end_reason = 'cashed_out'
    ), completed_rounds as materialized (
      select count(settled.*)::smallint as count
      from candidate
      left join duel_round_results settled
        on settled.match_id = candidate.match_id
        and settled.explorer_role = candidate.explorer_role
    ), target as materialized (
      select
        candidate.*,
        completed_rounds.count as completed_round_count,
        placement.coin_bag_numbers,
        placement.bomb_bag_number
      from candidate
      cross join completed_rounds
      inner join duel_round_placements placement
        on placement.match_id = candidate.match_id
        and placement.participant_role = candidate.placement_role
        and placement.round_number = ${input.roundNumber}
      where ${input.roundNumber} = completed_rounds.count + 1
        and ${input.roundNumber} between 1 and candidate.total_rounds
        and not exists (
          select 1
          from duel_round_results settled
          where settled.match_id = candidate.match_id
            and settled.explorer_role = candidate.explorer_role
            and settled.round_number = ${input.roundNumber}
        )
    ), open_summary as materialized (
      select
        target.*,
        count(distinct opened.open_order)::smallint as opened_bag_count,
        count(distinct opened.open_order)::smallint as distinct_order_count,
        min(opened.open_order)::smallint as first_open_order,
        max(opened.open_order)::smallint as last_open_order,
        count(coin_bag)::smallint as provisional_coins,
        coalesce(bool_or(opened.bag_number = target.bomb_bag_number), false) as bomb_opened
      from target
      left join duel_round_opens opened
        on opened.match_id = target.match_id
        and opened.explorer_role = target.explorer_role
        and opened.round_number = ${input.roundNumber}
      left join lateral unnest(target.coin_bag_numbers) coin_bag
        on coin_bag = opened.bag_number
      group by
        target.match_id,
        target.total_rounds,
        target.explorer_role,
        target.placement_role,
        target.completed_round_count,
        target.coin_bag_numbers,
        target.bomb_bag_number
    ), inserted as (
      insert into duel_round_results (
        match_id,
        round_number,
        explorer_role,
        placement_role,
        end_reason,
        terminal_open_order,
        captured_coins,
        bomb_hit,
        opened_bag_count,
        request_id,
        ended_at
      )
      select
        open_summary.match_id,
        ${input.roundNumber},
        open_summary.explorer_role,
        open_summary.placement_role,
        'cashed_out',
        null,
        open_summary.provisional_coins,
        false,
        open_summary.opened_bag_count,
        ${input.requestId}::uuid,
        statement_timestamp()
      from open_summary
      where open_summary.provisional_coins in (1, 2)
        and not open_summary.bomb_opened
        and open_summary.opened_bag_count > 0
        and open_summary.distinct_order_count = open_summary.opened_bag_count
        and open_summary.first_open_order = 1
        and open_summary.last_open_order = open_summary.opened_bag_count
        and not exists (select 1 from request_result)
      on conflict do nothing
      returning *
    ), new_response as materialized (
      select
        'cashed_out'::text as status,
        inserted.match_id,
        inserted.round_number,
        inserted.captured_coins,
        inserted.opened_bag_count,
        (open_summary.completed_round_count + 1 = open_summary.total_rounds) as participant_completed
      from inserted
      inner join open_summary
        on open_summary.match_id = inserted.match_id
        and open_summary.explorer_role = inserted.explorer_role
    ), retry_response as materialized (
      select
        'retry'::text as status,
        exact_retry.match_id,
        exact_retry.round_number,
        exact_retry.captured_coins,
        exact_retry.opened_bag_count,
        (
          select count(*) = exact_retry.total_rounds
          from duel_round_results completed
          where completed.match_id = exact_retry.match_id
            and completed.explorer_role = exact_retry.explorer_role
        ) as participant_completed
      from exact_retry
    ), response as (
      select * from retry_response
      union all
      select * from new_response
    )
    select * from response
    union all
    select
      case
        when not exists (select 1 from candidate) then 'unavailable'
        else 'conflict'
      end::text as status,
      null::uuid as match_id,
      null::smallint as round_number,
      null::smallint as captured_coins,
      null::smallint as opened_bag_count,
      null::boolean as participant_completed
    where not exists (select 1 from response)
  `)

  const row = result.rows[0]
  if (!row) throw new Error('DUEL CASH OUT did not return a status.')
  if (row.status === 'unavailable' || row.status === 'conflict') {
    return { status: row.status }
  }
  if (
    row.match_id === null ||
    row.round_number === null ||
    (row.captured_coins !== 1 && row.captured_coins !== 2) ||
    row.opened_bag_count === null ||
    row.participant_completed === null
  ) {
    throw new Error('DUEL CASH OUT returned an incomplete result.')
  }
  return {
    status: row.status,
    view: {
      matchId: row.match_id,
      roundNumber: row.round_number,
      endReason: 'cashed_out',
      capturedCoins: row.captured_coins,
      openedBagCount: row.opened_bag_count,
      participantCompleted: row.participant_completed,
    },
  }
}
