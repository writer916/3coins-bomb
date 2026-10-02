import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelPlayRole = 'A' | 'B'
export type DuelPlayOutcome = 'empty' | 'coins' | 'bomb'
export type DuelPlayEndReason = 'bombed' | 'cashed_out' | 'cleared'

export interface DuelOpenedBagView {
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: DuelPlayOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

export interface DuelActiveRoundView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly openedBags: readonly DuelOpenedBagView[]
  readonly provisionalCoins: 0 | 1 | 2
  readonly nextOpenOrder: number
}

export interface DuelTerminalRoundView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly openedBags: readonly DuelOpenedBagView[]
  readonly endReason: DuelPlayEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
}

export interface PersistedDuelPlayState {
  readonly matchId: string
  readonly role: DuelPlayRole
  readonly totalRounds: number
  readonly participantCompleted: boolean
  readonly nextPlayableRoundNumber: number | null
  readonly selfProgress: {
    readonly completedRounds: number
    readonly totalCapturedCoins: number
    readonly threeCoinsComplete: number
  }
  readonly activeRound: DuelActiveRoundView | null
  readonly latestTerminalRound: DuelTerminalRoundView | null
}

export interface GetDuelPlayStateInput {
  readonly matchId: string
  readonly participantTokenHash: string
}

interface RoundJson {
  readonly roundNumber: number
  readonly bagCount: number
  readonly openedBags: readonly DuelOpenedBagView[]
  readonly provisionalCoins?: number
  readonly nextOpenOrder?: number
  readonly endReason?: DuelPlayEndReason
  readonly capturedCoins?: number
  readonly openedBagCount?: number
}

interface DuelPlayStateRow extends Record<string, unknown> {
  readonly match_id: string
  readonly role: DuelPlayRole
  readonly total_rounds: number
  readonly completed_round_count: number
  readonly total_captured_coins: number
  readonly three_coins_complete: number
  readonly integrity_ok: boolean
  readonly active_round: RoundJson | null
  readonly latest_terminal_round: RoundJson | null
}

function openedBags(value: unknown): readonly DuelOpenedBagView[] {
  if (!Array.isArray(value)) throw new Error('DUEL play state is inconsistent.')
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('DUEL play state is inconsistent.')
    }
    const bag = item as Record<string, unknown>
    if (
      !Number.isInteger(bag.bagNumber) ||
      !Number.isInteger(bag.openOrder) ||
      !['empty', 'coins', 'bomb'].includes(bag.outcome as string) ||
      !Number.isInteger(bag.coinsFound) ||
      (bag.coinsFound as number) < 0 ||
      (bag.coinsFound as number) > 3
    ) {
      throw new Error('DUEL play state is inconsistent.')
    }
    return {
      bagNumber: bag.bagNumber as number,
      openOrder: bag.openOrder as number,
      outcome: bag.outcome as DuelPlayOutcome,
      coinsFound: bag.coinsFound as 0 | 1 | 2 | 3,
    }
  })
}

function activeRound(value: RoundJson | null): DuelActiveRoundView | null {
  if (value === null) return null
  if (
    !Number.isInteger(value.roundNumber) ||
    !Number.isInteger(value.bagCount) ||
    !Number.isInteger(value.provisionalCoins) ||
    (value.provisionalCoins as number) < 0 ||
    (value.provisionalCoins as number) > 2 ||
    !Number.isInteger(value.nextOpenOrder)
  ) {
    throw new Error('DUEL play state is inconsistent.')
  }
  return {
    roundNumber: value.roundNumber,
    bagCount: value.bagCount,
    openedBags: openedBags(value.openedBags),
    provisionalCoins: value.provisionalCoins as 0 | 1 | 2,
    nextOpenOrder: value.nextOpenOrder as number,
  }
}

function terminalRound(value: RoundJson | null): DuelTerminalRoundView | null {
  if (value === null) return null
  if (
    !Number.isInteger(value.roundNumber) ||
    !Number.isInteger(value.bagCount) ||
    !['bombed', 'cashed_out', 'cleared'].includes(value.endReason as string) ||
    !Number.isInteger(value.capturedCoins) ||
    (value.capturedCoins as number) < 0 ||
    (value.capturedCoins as number) > 3 ||
    !Number.isInteger(value.openedBagCount)
  ) {
    throw new Error('DUEL play state is inconsistent.')
  }
  return {
    roundNumber: value.roundNumber,
    bagCount: value.bagCount,
    openedBags: openedBags(value.openedBags),
    endReason: value.endReason as DuelPlayEndReason,
    capturedCoins: value.capturedCoins as 0 | 1 | 2 | 3,
    openedBagCount: value.openedBagCount as number,
  }
}

/** Returns only the authenticated explorer's known play state in one snapshot. */
export async function getDuelPlayStateForParticipant(
  input: GetDuelPlayStateInput,
): Promise<PersistedDuelPlayState | null> {
  const result = await getDatabase().execute<DuelPlayStateRow>(sql`
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
    ), result_progress as materialized (
      select
        candidate.*,
        count(result.*)::smallint as completed_round_count,
        coalesce(sum(result.captured_coins), 0)::integer as total_captured_coins,
        coalesce(
          sum(case when result.end_reason = 'cleared' then 1 else 0 end),
          0
        )::integer as three_coins_complete,
        count(distinct result.round_number)::smallint as distinct_result_count,
        min(result.round_number)::smallint as first_result_round,
        max(result.round_number)::smallint as last_result_round
      from candidate
      left join duel_round_results result
        on result.match_id = candidate.match_id
        and result.explorer_role = candidate.explorer_role
      group by
        candidate.match_id,
        candidate.total_rounds,
        candidate.explorer_role,
        candidate.placement_role
    ), result_integrity as materialized (
      select
        result_progress.*,
        (
          completed_round_count between 0 and total_rounds
          and distinct_result_count = completed_round_count
          and (
            completed_round_count = 0
            or (
              first_result_round = 1
              and last_result_round = completed_round_count
            )
          )
        ) as results_contiguous
      from result_progress
    ), open_groups as materialized (
      select
        opened.round_number,
        count(*)::smallint as open_count,
        count(distinct opened.open_order)::smallint as distinct_order_count,
        min(opened.open_order)::smallint as first_open_order,
        max(opened.open_order)::smallint as last_open_order
      from candidate
      inner join duel_round_opens opened
        on opened.match_id = candidate.match_id
        and opened.explorer_role = candidate.explorer_role
      group by opened.round_number
    ), open_integrity as materialized (
      select coalesce(bool_and(
        open_count = distinct_order_count
        and first_open_order = 1
        and last_open_order = open_count
      ), true) as opens_contiguous
      from open_groups
    ), round_scope as materialized (
      select
        'active'::text as round_kind,
        result_integrity.completed_round_count + 1 as round_number,
        null::text as end_reason,
        null::smallint as captured_coins,
        null::smallint as result_opened_bag_count
      from result_integrity
      where result_integrity.completed_round_count < result_integrity.total_rounds
      union all
      select
        'terminal'::text,
        result.round_number,
        result.end_reason,
        result.captured_coins,
        result.opened_bag_count
      from result_integrity
      inner join duel_round_results result
        on result.match_id = result_integrity.match_id
        and result.explorer_role = result_integrity.explorer_role
        and result.round_number = result_integrity.completed_round_count
      where result_integrity.completed_round_count > 0
    ), round_rows as materialized (
      select
        round_scope.round_kind,
        round_scope.round_number,
        placement.bag_count,
        round_scope.end_reason,
        round_scope.captured_coins,
        round_scope.result_opened_bag_count,
        opened.open_order,
        opened.bag_number,
        case
          when opened.bag_number is null then null
          when opened.bag_number = placement.bomb_bag_number then 'bomb'
          when coin_count.coins_found > 0 then 'coins'
          else 'empty'
        end as outcome,
        coalesce(coin_count.coins_found, 0)::smallint as coins_found
      from result_integrity
      inner join round_scope on true
      inner join duel_round_placements placement
        on placement.match_id = result_integrity.match_id
        and placement.participant_role = result_integrity.placement_role
        and placement.round_number = round_scope.round_number
      left join duel_round_opens opened
        on opened.match_id = result_integrity.match_id
        and opened.explorer_role = result_integrity.explorer_role
        and opened.round_number = round_scope.round_number
      left join lateral (
        select count(*)::smallint as coins_found
        from unnest(placement.coin_bag_numbers) coin_bag
        where coin_bag = opened.bag_number
      ) coin_count on opened.bag_number is not null
    ), round_data as materialized (
      select
        round_kind,
        round_number,
        bag_count,
        end_reason,
        captured_coins,
        result_opened_bag_count,
        count(open_order)::smallint as actual_open_count,
        coalesce(sum(coins_found), 0)::smallint as found_coins,
        coalesce(bool_or(outcome = 'bomb'), false) as opened_bomb,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'bagNumber', bag_number,
              'openOrder', open_order,
              'outcome', outcome,
              'coinsFound', coins_found
            ) order by open_order
          ) filter (where open_order is not null),
          '[]'::jsonb
        ) as opened_bags
      from round_rows
      group by
        round_kind,
        round_number,
        bag_count,
        end_reason,
        captured_coins,
        result_opened_bag_count
    ), scoped_integrity as materialized (
      select coalesce(bool_and(
        case
          when round_kind = 'active' then
            not opened_bomb
            and found_coins between 0 and 2
          when end_reason = 'bombed' then
            opened_bomb
            and found_coins between 0 and 2
            and captured_coins = 0
            and actual_open_count = result_opened_bag_count
          when end_reason = 'cleared' then
            not opened_bomb
            and found_coins = 3
            and captured_coins = 3
            and actual_open_count = result_opened_bag_count
          when end_reason = 'cashed_out' then
            not opened_bomb
            and found_coins = captured_coins
            and captured_coins in (1, 2)
            and actual_open_count = result_opened_bag_count
          else false
        end
      ), true) as scoped_rounds_valid
      from round_data
    )
    select
      result_integrity.match_id,
      result_integrity.explorer_role as role,
      result_integrity.total_rounds,
      result_integrity.completed_round_count,
      result_integrity.total_captured_coins,
      result_integrity.three_coins_complete,
      (
        result_integrity.results_contiguous
        and open_integrity.opens_contiguous
        and scoped_integrity.scoped_rounds_valid
        and not exists (
          select 1
          from open_groups
          where open_groups.round_number > result_integrity.completed_round_count + 1
        )
      ) as integrity_ok,
      (
        select jsonb_build_object(
          'roundNumber', round_data.round_number,
          'bagCount', round_data.bag_count,
          'openedBags', round_data.opened_bags,
          'provisionalCoins', round_data.found_coins,
          'nextOpenOrder', round_data.actual_open_count + 1
        )
        from round_data
        where round_data.round_kind = 'active'
      ) as active_round,
      (
        select jsonb_build_object(
          'roundNumber', round_data.round_number,
          'bagCount', round_data.bag_count,
          'openedBags', round_data.opened_bags,
          'endReason', round_data.end_reason,
          'capturedCoins', round_data.captured_coins,
          'openedBagCount', round_data.result_opened_bag_count
        )
        from round_data
        where round_data.round_kind = 'terminal'
      ) as latest_terminal_round
    from result_integrity
    cross join open_integrity
    cross join scoped_integrity
  `)

  const row = result.rows[0]
  if (!row) return null
  if (!row.integrity_ok) throw new Error('DUEL play state is inconsistent.')
  if (
    !Number.isInteger(row.total_captured_coins) ||
    row.total_captured_coins < 0 ||
    row.total_captured_coins > row.completed_round_count * 3 ||
    !Number.isInteger(row.three_coins_complete) ||
    row.three_coins_complete < 0 ||
    row.three_coins_complete > row.completed_round_count
  ) throw new Error('DUEL play state is inconsistent.')

  const completed = row.completed_round_count === row.total_rounds
  return {
    matchId: row.match_id,
    role: row.role,
    totalRounds: row.total_rounds,
    participantCompleted: completed,
    nextPlayableRoundNumber: completed ? null : row.completed_round_count + 1,
    selfProgress: {
      completedRounds: row.completed_round_count,
      totalCapturedCoins: row.total_captured_coins,
      threeCoinsComplete: row.three_coins_complete,
    },
    activeRound: activeRound(row.active_round),
    latestTerminalRound: terminalRound(row.latest_terminal_round),
  }
}
