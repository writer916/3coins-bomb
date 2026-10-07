import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type GroupOpenOutcome = 'empty' | 'coins' | 'bomb'
export type GroupOpenEndReason = 'bombed' | 'cleared' | null
export interface GroupOpenView {
  readonly groupId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: GroupOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: GroupOpenEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
}
export type OpenGroupBagResult =
  | { readonly status: 'opened' | 'retry'; readonly view: GroupOpenView }
  | { readonly status: 'unavailable' | 'conflict' }

interface Row extends Record<string, unknown> {
  readonly status: 'opened' | 'retry' | 'unavailable' | 'conflict'
  readonly group_id: string | null
  readonly round_number: number | null
  readonly bag_number: number | null
  readonly open_order: number | null
  readonly outcome: GroupOpenOutcome | null
  readonly coins_found: number | null
  readonly provisional_coins: number | null
  readonly opened_bag_count: number | null
  readonly round_ended: boolean | null
  readonly end_reason: GroupOpenEndReason
  readonly captured_coins: number | null
}

export async function persistGroupBagOpen(input: {
  readonly groupId: string
  readonly participantTokenHash: string
  readonly requestId: string
  readonly bagNumber: number
}): Promise<OpenGroupBagResult> {
  const result = await getDatabase().execute<Row>(sql`
    with candidate as materialized (
      select participant.id as participant_id, participant.group_id
      from group_participants participant
      where participant.group_id = ${input.groupId}::uuid
        and participant.auth_token_hash = ${input.participantTokenHash}
        and participant.excluded_at is null
      for update
    ), request_open as materialized (
      select opened.*
      from group_round_opens opened
      inner join candidate
        on candidate.group_id = opened.group_id
        and candidate.participant_id = opened.participant_id
      where opened.request_id = ${input.requestId}::uuid
    ), exact_retry as materialized (
      select opened.*
      from request_open opened
      where opened.bag_number = ${input.bagNumber}
    ), target as materialized (
      select
        candidate.participant_id,
        candidate.group_id,
        attempt.round_number,
        attempt.opened_bag_count,
        placement.bag_count,
        placement.bomb_bag_number,
        placement.coin_bag_numbers,
        exists(
          select 1 from group_round_opens prior
          where prior.participant_id = candidate.participant_id
            and prior.round_number = attempt.round_number
            and prior.bag_number = ${input.bagNumber}
        ) as already_opened
      from candidate
      inner join group_round_attempts attempt
        on attempt.group_id = candidate.group_id
        and attempt.participant_id = candidate.participant_id
        and attempt.status = 'active'
      inner join group_round_placements placement
        on placement.group_id = candidate.group_id
        and placement.round_number = attempt.round_number
      where ${input.bagNumber} between 1 and placement.bag_count
    ), inserted_open as (
      insert into group_round_opens (
        participant_id, group_id, round_number, open_order,
        bag_number, request_id, opened_at
      )
      select
        target.participant_id,
        target.group_id,
        target.round_number,
        target.opened_bag_count + 1,
        ${input.bagNumber},
        ${input.requestId}::uuid,
        statement_timestamp()
      from target
      where not target.already_opened
        and not exists(select 1 from request_open)
      on conflict do nothing
      returning *
    ), judged as materialized (
      select
        inserted.*,
        target.bomb_bag_number,
        coalesce(prior.provisional_coins, 0)::smallint as prior_coins,
        (${input.bagNumber} = target.bomb_bag_number) as bomb_hit,
        (
          select count(*)::smallint
          from unnest(target.coin_bag_numbers) coin_bag
          where coin_bag = ${input.bagNumber}
        ) as coins_found
      from inserted_open inserted
      inner join target
        on target.participant_id = inserted.participant_id
        and target.round_number = inserted.round_number
      left join lateral (
        select count(coin_bag)::smallint as provisional_coins
        from group_round_opens prior_open
        left join lateral unnest(target.coin_bag_numbers) coin_bag
          on coin_bag = prior_open.bag_number
        where prior_open.participant_id = target.participant_id
          and prior_open.round_number = target.round_number
          and prior_open.open_order < inserted.open_order
      ) prior on true
    ), updated_attempt as (
      update group_round_attempts attempt
      set
        opened_bag_count = judged.open_order,
        captured_coins = case
          when judged.bomb_hit then judged.prior_coins
          when judged.prior_coins + judged.coins_found = 3 then 3
          else 0
        end,
        status = case
          when judged.bomb_hit then 'bombed'
          when judged.prior_coins + judged.coins_found = 3 then 'cleared'
          else 'active'
        end,
        ended_at = case
          when judged.bomb_hit or judged.prior_coins + judged.coins_found = 3
          then statement_timestamp()
          else null
        end,
        terminal_request_id = case
          when judged.bomb_hit or judged.prior_coins + judged.coins_found = 3
          then judged.request_id
          else null
        end,
        version = attempt.version + 1
      from judged
      where attempt.group_id = judged.group_id
        and attempt.participant_id = judged.participant_id
        and attempt.round_number = judged.round_number
        and attempt.status = 'active'
        and attempt.opened_bag_count + 1 = judged.open_order
      returning attempt.*, judged.bag_number, judged.open_order,
        judged.bomb_hit, judged.coins_found, judged.prior_coins
    ), completed_participant as (
      update group_participants participant
      set completed_at = statement_timestamp(), version = participant.version + 1
      from updated_attempt updated
      inner join group_matches match on match.id = updated.group_id
      where participant.id = updated.participant_id
        and participant.group_id = updated.group_id
        and updated.status <> 'active'
        and updated.round_number = match.total_rounds
        and participant.completed_at is null
        and participant.excluded_at is null
      returning participant.id
    ), new_response as materialized (
      select
        'opened'::text as status,
        updated.group_id,
        updated.round_number,
        updated.bag_number,
        updated.open_order,
        case when updated.bomb_hit then 'bomb'
          when updated.coins_found > 0 then 'coins' else 'empty' end::text as outcome,
        updated.coins_found,
        case when updated.status = 'active' then updated.prior_coins + updated.coins_found else updated.captured_coins end::smallint as provisional_coins,
        updated.opened_bag_count,
        (updated.status <> 'active') as round_ended,
        case when updated.status = 'active' then null else updated.status end::text as end_reason,
        updated.captured_coins
      from updated_attempt updated
    ), retry_response as materialized (
      select
        'retry'::text as status,
        opened.group_id,
        opened.round_number,
        opened.bag_number,
        opened.open_order,
        case when opened.bag_number = placement.bomb_bag_number then 'bomb'
          when found.coins_found > 0 then 'coins' else 'empty' end::text as outcome,
        found.coins_found,
        found.provisional_coins,
        opened.open_order as opened_bag_count,
        coalesce(attempt.terminal_request_id = opened.request_id, false) as round_ended,
        case when attempt.terminal_request_id = opened.request_id then attempt.status else null end::text as end_reason,
        case when attempt.terminal_request_id = opened.request_id
          then attempt.captured_coins else found.provisional_coins end::smallint as captured_coins
      from exact_retry opened
      inner join group_round_placements placement
        on placement.group_id = opened.group_id
        and placement.round_number = opened.round_number
      inner join group_round_attempts attempt
        on attempt.group_id = opened.group_id
        and attempt.participant_id = opened.participant_id
        and attempt.round_number = opened.round_number
      cross join lateral (
        select
          count(*) filter (where coin_bag is not null and prior.open_order = opened.open_order)::smallint as coins_found,
          count(coin_bag)::smallint as provisional_coins
        from group_round_opens prior
        left join lateral unnest(placement.coin_bag_numbers) coin_bag
          on coin_bag = prior.bag_number
        where prior.participant_id = opened.participant_id
          and prior.round_number = opened.round_number
          and prior.open_order <= opened.open_order
      ) found
    )
    select * from new_response
    union all
    select * from retry_response
    union all
    select
      case when exists(select 1 from candidate) then 'conflict' else 'unavailable' end,
      null, null, null, null, null, null, null, null, null, null, null
    where not exists(select 1 from new_response)
      and not exists(select 1 from retry_response)
  `)
  const row = result.rows[0]!
  if (row.status === 'unavailable' || row.status === 'conflict') return { status: row.status }
  if (
    row.group_id === null || row.round_number === null || row.bag_number === null ||
    row.open_order === null || row.outcome === null || row.coins_found === null ||
    row.provisional_coins === null || row.opened_bag_count === null ||
    row.round_ended === null || row.captured_coins === null
  ) throw new Error('GROUP OPEN response is inconsistent.')
  return {
    status: row.status,
    view: {
      groupId: row.group_id,
      roundNumber: row.round_number,
      bagNumber: row.bag_number,
      openOrder: row.open_order,
      outcome: row.outcome,
      coinsFound: row.coins_found as 0 | 1 | 2 | 3,
      provisionalCoins: row.provisional_coins as 0 | 1 | 2 | 3,
      openedBagCount: row.opened_bag_count,
      roundEnded: row.round_ended,
      endReason: row.end_reason,
      capturedCoins: row.captured_coins as 0 | 1 | 2 | 3,
    },
  }
}
