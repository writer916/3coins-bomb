import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelOpenOutcome = 'empty' | 'coins' | 'bomb'
export type DuelOpenEndReason = 'bombed' | 'cleared' | null

export interface OpenDuelBagInput {
  readonly matchId: string
  readonly participantTokenHash: string
  readonly requestId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly expectedOpenOrder: number
}

export interface DuelDatabaseTiming {
  readonly startedAtMs: number
  readonly durationMs: number
}

export interface OpenDuelBagDiagnostics {
  readonly onExecuteTiming?: (timing: DuelDatabaseTiming) => void
}

export interface OpenDuelBagView {
  readonly matchId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: DuelOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: DuelOpenEndReason
  readonly capturedCoins: 0 | 3 | null
  readonly participantCompleted: boolean
}

export type OpenDuelBagResult =
  | { readonly status: 'opened' | 'retry'; readonly view: OpenDuelBagView }
  | { readonly status: 'unavailable' | 'conflict' }

interface OpenDuelBagRow extends Record<string, unknown> {
  readonly status: 'opened' | 'retry' | 'unavailable' | 'conflict'
  readonly match_id: string | null
  readonly round_number: number | null
  readonly bag_number: number | null
  readonly open_order: number | null
  readonly outcome: DuelOpenOutcome | null
  readonly coins_found: number | null
  readonly provisional_coins: number | null
  readonly opened_bag_count: number | null
  readonly round_ended: boolean | null
  readonly end_reason: DuelOpenEndReason
  readonly captured_coins: number | null
  readonly participant_completed: boolean | null
}

/**
 * Judges and records one OPEN in one statement. Locking the explorer row
 * serializes that participant's requests without blocking the opponent.
 */
export async function persistDuelBagOpen(
  input: OpenDuelBagInput,
  diagnostics: OpenDuelBagDiagnostics = {},
): Promise<OpenDuelBagResult> {
  const databaseStartedAtMs = performance.now()
  let result
  try {
    result = await getDatabase().execute<OpenDuelBagRow>(sql`
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
    ), request_open as materialized (
      select opened.*
      from duel_round_opens opened
      where opened.request_id = ${input.requestId}::uuid
    ), exact_retry as materialized (
      select opened.*
      from request_open opened
      inner join candidate
        on candidate.match_id = opened.match_id
        and candidate.explorer_role = opened.explorer_role
        and candidate.placement_role = opened.placement_role
      where opened.round_number = ${input.roundNumber}
        and opened.bag_number = ${input.bagNumber}
        and opened.open_order = ${input.expectedOpenOrder}
    ), completed_rounds as materialized (
      select count(result.*)::smallint as count
      from candidate
      left join duel_round_results result
        on result.match_id = candidate.match_id
        and result.explorer_role = candidate.explorer_role
    ), target as materialized (
      select
        candidate.*,
        placement.bag_count,
        placement.bomb_bag_number,
        placement.coin_bag_numbers,
        completed_rounds.count as completed_round_count,
        coalesce(prior.opened_bag_count, 0)::smallint as opened_bag_count,
        coalesce(prior.provisional_coins, 0)::smallint as provisional_coins,
        coalesce(prior.already_opened, false) as already_opened
      from candidate
      cross join completed_rounds
      inner join duel_round_placements placement
        on placement.match_id = candidate.match_id
        and placement.participant_role = candidate.placement_role
        and placement.round_number = ${input.roundNumber}
      left join lateral (
        select
          count(distinct opened.open_order)::smallint as opened_bag_count,
          count(coin_bag)::smallint as provisional_coins,
          bool_or(opened.bag_number = ${input.bagNumber}) as already_opened
        from duel_round_opens opened
        left join lateral unnest(placement.coin_bag_numbers) coin_bag
          on coin_bag = opened.bag_number
        where opened.match_id = candidate.match_id
          and opened.explorer_role = candidate.explorer_role
          and opened.round_number = ${input.roundNumber}
      ) prior on true
      where ${input.roundNumber} = completed_rounds.count + 1
        and ${input.roundNumber} between 1 and candidate.total_rounds
        and ${input.bagNumber} between 1 and placement.bag_count
        and not exists (
          select 1
          from duel_round_results result
          where result.match_id = candidate.match_id
            and result.explorer_role = candidate.explorer_role
            and result.round_number = ${input.roundNumber}
        )
    ), selected as materialized (
      select
        target.*,
        (${input.expectedOpenOrder} = target.opened_bag_count + 1) as order_matches,
        (${input.bagNumber} = target.bomb_bag_number) as bomb_hit,
        (
          select count(*)::smallint
          from unnest(target.coin_bag_numbers) coin_bag
          where coin_bag = ${input.bagNumber}
        ) as coins_found
      from target
    ), inserted_open as (
      insert into duel_round_opens (
        match_id,
        round_number,
        explorer_role,
        placement_role,
        open_order,
        bag_number,
        request_id,
        opened_at
      )
      select
        selected.match_id,
        ${input.roundNumber},
        selected.explorer_role,
        selected.placement_role,
        ${input.expectedOpenOrder},
        ${input.bagNumber},
        ${input.requestId}::uuid,
        statement_timestamp()
      from selected
      where not selected.already_opened
        and selected.order_matches
        and not exists (select 1 from request_open)
      on conflict do nothing
      returning *
    ), opened_view as materialized (
      select
        inserted_open.*,
        selected.total_rounds,
        selected.completed_round_count,
        selected.bomb_hit,
        selected.coins_found,
        (selected.provisional_coins + selected.coins_found)::smallint as found_coins,
        (selected.opened_bag_count + 1)::smallint as opened_count
      from inserted_open
      inner join selected
        on selected.match_id = inserted_open.match_id
        and selected.explorer_role = inserted_open.explorer_role
    ), inserted_result as (
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
        opened_view.match_id,
        opened_view.round_number,
        opened_view.explorer_role,
        opened_view.placement_role,
        case when opened_view.bomb_hit then 'bombed' else 'cleared' end,
        opened_view.open_order,
        case when opened_view.bomb_hit then 0 else 3 end,
        opened_view.bomb_hit,
        opened_view.opened_count,
        opened_view.request_id,
        statement_timestamp()
      from opened_view
      where opened_view.bomb_hit or opened_view.found_coins = 3
      returning *
    ), new_response as materialized (
      select
        'opened'::text as status,
        opened_view.match_id,
        opened_view.round_number,
        opened_view.bag_number,
        opened_view.open_order,
        case
          when opened_view.bomb_hit then 'bomb'
          when opened_view.coins_found > 0 then 'coins'
          else 'empty'
        end::text as outcome,
        opened_view.coins_found,
        case when opened_view.bomb_hit then 0 else opened_view.found_coins end::smallint as provisional_coins,
        opened_view.opened_count as opened_bag_count,
        (inserted_result.match_id is not null) as round_ended,
        inserted_result.end_reason,
        inserted_result.captured_coins,
        (
          inserted_result.match_id is not null
          and opened_view.completed_round_count + 1 = opened_view.total_rounds
        ) as participant_completed
      from opened_view
      left join inserted_result
        on inserted_result.match_id = opened_view.match_id
        and inserted_result.explorer_role = opened_view.explorer_role
        and inserted_result.round_number = opened_view.round_number
    ), retry_response as materialized (
      select
        'retry'::text as status,
        exact_retry.match_id,
        exact_retry.round_number,
        exact_retry.bag_number,
        exact_retry.open_order,
        case
          when exact_retry.bag_number = placement.bomb_bag_number then 'bomb'
          when found.coins_found > 0 then 'coins'
          else 'empty'
        end::text as outcome,
        found.coins_found,
        case
          when result.end_reason = 'bombed' then 0
          else found.provisional_coins
        end::smallint as provisional_coins,
        exact_retry.open_order as opened_bag_count,
        (result.match_id is not null) as round_ended,
        result.end_reason,
        result.captured_coins,
        (
          result.match_id is not null
          and (
            select count(*)
            from duel_round_results completed
            where completed.match_id = exact_retry.match_id
              and completed.explorer_role = exact_retry.explorer_role
          ) = candidate.total_rounds
        ) as participant_completed
      from exact_retry
      inner join candidate on candidate.match_id = exact_retry.match_id
      inner join duel_round_placements placement
        on placement.match_id = exact_retry.match_id
        and placement.participant_role = exact_retry.placement_role
        and placement.round_number = exact_retry.round_number
      left join duel_round_results result
        on result.match_id = exact_retry.match_id
        and result.explorer_role = exact_retry.explorer_role
        and result.round_number = exact_retry.round_number
      cross join lateral (
        select
          (
            select count(*)::smallint
            from unnest(placement.coin_bag_numbers) coin_bag
            where coin_bag = exact_retry.bag_number
          ) as coins_found,
          (
            select count(coin_bag)::smallint
            from duel_round_opens opened
            left join lateral unnest(placement.coin_bag_numbers) coin_bag
              on coin_bag = opened.bag_number
            where opened.match_id = exact_retry.match_id
              and opened.explorer_role = exact_retry.explorer_role
              and opened.round_number = exact_retry.round_number
              and opened.open_order <= exact_retry.open_order
          ) as provisional_coins
      ) found
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
      null::smallint as bag_number,
      null::smallint as open_order,
      null::text as outcome,
      null::smallint as coins_found,
      null::smallint as provisional_coins,
      null::smallint as opened_bag_count,
      null::boolean as round_ended,
      null::text as end_reason,
      null::smallint as captured_coins,
      null::boolean as participant_completed
    where not exists (select 1 from response)
    `)
  } finally {
    diagnostics.onExecuteTiming?.({
      startedAtMs: databaseStartedAtMs,
      durationMs: performance.now() - databaseStartedAtMs,
    })
  }

  const row = result.rows[0]
  if (!row) throw new Error('DUEL OPEN did not return a status.')
  if (row.status === 'unavailable' || row.status === 'conflict') {
    return { status: row.status }
  }
  if (
    row.match_id === null ||
    row.round_number === null ||
    row.bag_number === null ||
    row.open_order === null ||
    row.outcome === null ||
    row.coins_found === null ||
    row.provisional_coins === null ||
    row.opened_bag_count === null ||
    row.round_ended === null ||
    row.participant_completed === null
  ) {
    throw new Error('DUEL OPEN returned an incomplete result.')
  }
  return {
    status: row.status,
    view: {
      matchId: row.match_id,
      roundNumber: row.round_number,
      bagNumber: row.bag_number,
      openOrder: row.open_order,
      outcome: row.outcome,
      coinsFound: row.coins_found as 0 | 1 | 2 | 3,
      provisionalCoins: row.provisional_coins as 0 | 1 | 2 | 3,
      openedBagCount: row.opened_bag_count,
      roundEnded: row.round_ended,
      endReason: row.end_reason,
      capturedCoins: row.captured_coins as 0 | 3 | null,
      participantCompleted: row.participant_completed,
    },
  }
}
