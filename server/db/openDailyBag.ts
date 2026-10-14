import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import {
  dailyChallengePeriod,
  dailyElapsedSecondsAtTap,
  DAILY_OPERATION_GRACE_SECONDS,
  DAILY_ROUND_LIMIT_SECONDS,
} from '../../src/daily/dailyTime.js'
import { getDatabase } from './client.js'

/** Matches dailyPlay TIME OUT finalize (UI 60s + delivery grace). */
const TIMEOUT_FINALIZE_SECONDS =
  DAILY_ROUND_LIMIT_SECONDS + DAILY_OPERATION_GRACE_SECONDS

export type DailyOpenOutcome = 'empty' | 'coins' | 'bomb'
export type DailyOpenEndReason = 'bombed' | 'cleared' | null

export interface DailyOpenView {
  readonly challengeDate: DailyChallengeDate
  readonly participantId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly remainingSecondsAtTap: number
  readonly outcome: DailyOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: DailyOpenEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly elapsedSeconds: number | null
  readonly coinBagHits: number | null
  readonly participantCompleted: boolean
}

export type OpenDailyBagResult =
  | { readonly status: 'opened' | 'retry'; readonly view: DailyOpenView }
  | { readonly status: 'unavailable' | 'conflict' }

interface Row extends Record<string, unknown> {
  readonly status: 'opened' | 'retry' | 'unavailable' | 'conflict'
  readonly challenge_date: string | null
  readonly participant_id: string | null
  readonly round_number: number | null
  readonly bag_number: number | null
  readonly open_order: number | null
  readonly remaining_seconds_at_tap: number | null
  readonly outcome: DailyOpenOutcome | null
  readonly coins_found: number | null
  readonly provisional_coins: number | null
  readonly opened_bag_count: number | null
  readonly round_ended: boolean | null
  readonly end_reason: DailyOpenEndReason
  readonly captured_coins: number | null
  readonly elapsed_seconds: number | null
  readonly coin_bag_hits: number | null
  readonly participant_completed: boolean | null
}

function asOfExpression(nowMs: number | undefined) {
  if (nowMs === undefined) return sql`statement_timestamp()`
  return sql`${new Date(nowMs).toISOString()}::timestamptz`
}

/**
 * Atomically OPENs one DAILY bag under the participant row lock.
 * TIME OUT finalize (62s / UTC day end) runs in the same statement before OPEN
 * so lock-wait cannot admit a late OPEN after irreversible timeout.
 * Never returns placement coordinates.
 */
export async function openDailyBag(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  readonly requestId: string
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
  /** Test seam — defaults to database `statement_timestamp()`. */
  readonly nowMs?: number
}): Promise<OpenDailyBagResult> {
  void dailyChallengePeriod(input.challengeDate)
  // Spec mirror: invalid R is rejected before SQL (same rules as SQL timing CTE).
  try {
    dailyElapsedSecondsAtTap(input.remainingSecondsAtTap)
  } catch {
    return { status: 'conflict' }
  }
  if (
    !Number.isInteger(input.bagNumber) ||
    input.bagNumber < 1 ||
    input.bagNumber > 8
  ) {
    return { status: 'conflict' }
  }

  const asOf = asOfExpression(input.nowMs)
  const result = await getDatabase().execute<Row>(sql`
    with params as materialized (
      select
        ${input.challengeDate}::date as challenge_date,
        ${input.authTokenHash} as auth_token_hash,
        ${input.requestId}::uuid as request_id,
        ${input.bagNumber}::smallint as bag_number,
        ${input.remainingSecondsAtTap}::smallint as remaining_seconds_at_tap,
        ${asOf} as now_ts,
        (${input.challengeDate}::timestamp at time zone 'UTC' + interval '1 day')
          as challenge_ends_at
    ),
    locked_participant as materialized (
      select
        participant.id,
        participant.challenge_date,
        participant.completed_at,
        participant.expired_at,
        params.now_ts,
        params.challenge_ends_at,
        params.request_id,
        params.bag_number,
        params.remaining_seconds_at_tap,
        params.auth_token_hash
      from daily_challenge_participants participant
      inner join params
        on params.challenge_date = participant.challenge_date
        and params.auth_token_hash = participant.auth_token_hash
      for update of participant
    ),
    timed_out as (
      update daily_challenge_round_attempts attempt
      set
        status = 'timed_out',
        ended_at = locked.now_ts,
        elapsed_seconds = ${DAILY_ROUND_LIMIT_SECONDS},
        captured_coins = 0,
        coin_bag_hits = coalesce((
          select count(*)::smallint
          from daily_challenge_round_opens open_row
          inner join daily_challenge_placements placement
            on placement.challenge_date = attempt.challenge_date
            and placement.round_number = attempt.challenge_round_number
          where open_row.participant_id = attempt.participant_id
            and open_row.round_number = attempt.round_number
            and open_row.bag_number = any (placement.coin_bag_numbers)
        ), 0),
        version = attempt.version + 1
      from locked_participant locked
      where attempt.participant_id = locked.id
        and attempt.challenge_date = locked.challenge_date
        and attempt.status = 'active'
        and (
          locked.now_ts >= locked.challenge_ends_at
          or locked.now_ts >= attempt.started_at
            + make_interval(secs => ${TIMEOUT_FINALIZE_SECONDS})
        )
      returning attempt.participant_id, attempt.round_number
    ),
    completed_after_timeout as (
      update daily_challenge_participants participant
      set
        completed_at = locked.now_ts,
        version = participant.version + 1,
        updated_at = locked.now_ts
      from locked_participant locked
      where participant.id = locked.id
        and participant.challenge_date = locked.challenge_date
        and participant.completed_at is null
        and participant.expired_at is null
        and locked.now_ts < locked.challenge_ends_at
        and (
          (
            select count(*)::integer
            from daily_challenge_round_attempts attempt
            where attempt.participant_id = locked.id
              and attempt.challenge_date = locked.challenge_date
              and attempt.status <> 'active'
          ) + (select count(*)::integer from timed_out)
        ) = ${DAILY_CHALLENGE_ROUNDS}
      returning participant.id
    ),
    expired_after_timeout as (
      update daily_challenge_participants participant
      set
        expired_at = locked.now_ts,
        version = participant.version + 1,
        updated_at = locked.now_ts
      from locked_participant locked
      where participant.id = locked.id
        and participant.challenge_date = locked.challenge_date
        and participant.completed_at is null
        and participant.expired_at is null
        and locked.now_ts >= locked.challenge_ends_at
        and not exists (select 1 from completed_after_timeout)
      returning participant.id
    ),
    request_open as materialized (
      select opened.*
      from daily_challenge_round_opens opened
      inner join locked_participant locked
        on locked.id = opened.participant_id
        and locked.challenge_date = opened.challenge_date
      where opened.request_id = locked.request_id
    ),
    exact_retry as materialized (
      select opened.*
      from request_open opened
      where opened.bag_number = (
        select locked.bag_number from locked_participant locked limit 1
      )
    ),
    target as materialized (
      select
        locked.id as participant_id,
        locked.challenge_date,
        locked.now_ts,
        locked.challenge_ends_at,
        locked.request_id,
        locked.bag_number,
        locked.remaining_seconds_at_tap,
        attempt.round_number,
        attempt.started_at,
        attempt.opened_bag_count,
        placement.bag_count,
        placement.bomb_bag_number,
        placement.coin_bag_numbers,
        exists(
          select 1 from daily_challenge_round_opens prior
          where prior.participant_id = locked.id
            and prior.round_number = attempt.round_number
            and prior.bag_number = locked.bag_number
        ) as already_opened,
        (
          locked.remaining_seconds_at_tap between 1 and ${DAILY_ROUND_LIMIT_SECONDS}
          and locked.now_ts < locked.challenge_ends_at
          and locked.now_ts >= attempt.started_at
            + make_interval(
              secs => ${DAILY_ROUND_LIMIT_SECONDS} - locked.remaining_seconds_at_tap
            )
          and locked.now_ts < attempt.started_at
            + make_interval(
              secs => ${DAILY_ROUND_LIMIT_SECONDS} - locked.remaining_seconds_at_tap + 1
                + ${DAILY_OPERATION_GRACE_SECONDS}
            )
        ) as timing_ok
      from locked_participant locked
      inner join daily_challenge_round_attempts attempt
        on attempt.participant_id = locked.id
        and attempt.challenge_date = locked.challenge_date
        and attempt.status = 'active'
      inner join daily_challenge_placements placement
        on placement.challenge_date = attempt.challenge_date
        and placement.round_number = attempt.challenge_round_number
      where locked.completed_at is null
        and locked.expired_at is null
        and locked.bag_number between 1 and placement.bag_count
    ),
    inserted_open as (
      insert into daily_challenge_round_opens (
        participant_id,
        challenge_date,
        round_number,
        open_order,
        bag_number,
        request_id,
        remaining_seconds_at_tap,
        opened_at
      )
      select
        target.participant_id,
        target.challenge_date,
        target.round_number,
        target.opened_bag_count + 1,
        target.bag_number,
        target.request_id,
        target.remaining_seconds_at_tap,
        target.now_ts
      from target
      where target.timing_ok
        and not target.already_opened
        and not exists (select 1 from request_open)
      on conflict do nothing
      returning *
    ),
    judged as materialized (
      select
        inserted.*,
        target.bomb_bag_number,
        target.coin_bag_numbers,
        target.now_ts,
        coalesce(prior.provisional_coins, 0)::smallint as prior_coins,
        (inserted.bag_number = target.bomb_bag_number) as bomb_hit,
        (
          select count(*)::smallint
          from unnest(target.coin_bag_numbers) coin_bag
          where coin_bag = inserted.bag_number
        ) as coins_found,
        (
          ${DAILY_ROUND_LIMIT_SECONDS} - inserted.remaining_seconds_at_tap
        )::smallint as elapsed_seconds
      from inserted_open inserted
      inner join target
        on target.participant_id = inserted.participant_id
        and target.round_number = inserted.round_number
      left join lateral (
        select count(coin_bag)::smallint as provisional_coins
        from daily_challenge_round_opens prior_open
        left join lateral unnest(target.coin_bag_numbers) coin_bag
          on coin_bag = prior_open.bag_number
        where prior_open.participant_id = target.participant_id
          and prior_open.round_number = target.round_number
          and prior_open.open_order < inserted.open_order
      ) prior on true
    ),
    updated_attempt as (
      update daily_challenge_round_attempts attempt
      set
        opened_bag_count = judged.open_order,
        captured_coins = case
          when judged.bomb_hit then 0
          when judged.prior_coins + judged.coins_found = 3 then 3
          else attempt.captured_coins
        end,
        coin_bag_hits = case
          when judged.bomb_hit
            or judged.prior_coins + judged.coins_found = 3
          then (
            coalesce((
              select count(*)::smallint
              from daily_challenge_round_opens open_row
              where open_row.participant_id = judged.participant_id
                and open_row.round_number = judged.round_number
                and open_row.open_order < judged.open_order
                and open_row.bag_number = any (judged.coin_bag_numbers)
            ), 0)
            + case when judged.coins_found > 0 then 1 else 0 end
          )::smallint
          else attempt.coin_bag_hits
        end,
        status = case
          when judged.bomb_hit then 'bombed'
          when judged.prior_coins + judged.coins_found = 3 then 'cleared'
          else 'active'
        end,
        elapsed_seconds = case
          when judged.bomb_hit
            or judged.prior_coins + judged.coins_found = 3
          then judged.elapsed_seconds
          else attempt.elapsed_seconds
        end,
        ended_at = case
          when judged.bomb_hit
            or judged.prior_coins + judged.coins_found = 3
          then judged.now_ts
          else null
        end,
        terminal_request_id = case
          when judged.bomb_hit
            or judged.prior_coins + judged.coins_found = 3
          then judged.request_id
          else null
        end,
        version = attempt.version + 1
      from judged
      where attempt.participant_id = judged.participant_id
        and attempt.challenge_date = judged.challenge_date
        and attempt.round_number = judged.round_number
        and attempt.status = 'active'
        and attempt.opened_bag_count + 1 = judged.open_order
      returning
        attempt.*,
        judged.bag_number,
        judged.open_order,
        judged.remaining_seconds_at_tap,
        judged.bomb_hit,
        judged.coins_found,
        judged.prior_coins
    ),
    completed_participant as (
      update daily_challenge_participants participant
      set
        completed_at = updated.ended_at,
        version = participant.version + 1,
        updated_at = updated.ended_at
      from updated_attempt updated
      where participant.id = updated.participant_id
        and participant.challenge_date = updated.challenge_date
        and updated.status <> 'active'
        and updated.round_number = ${DAILY_CHALLENGE_ROUNDS}
        and participant.completed_at is null
        and participant.expired_at is null
        and updated.ended_at < (
          updated.challenge_date::timestamp at time zone 'UTC' + interval '1 day'
        )
      returning participant.id
    ),
    new_response as materialized (
      select
        'opened'::text as status,
        updated.challenge_date,
        updated.participant_id,
        updated.round_number,
        updated.bag_number,
        updated.open_order,
        updated.remaining_seconds_at_tap,
        case
          when updated.bomb_hit then 'bomb'
          when updated.coins_found > 0 then 'coins'
          else 'empty'
        end::text as outcome,
        updated.coins_found,
        case
          when updated.status = 'active'
          then updated.prior_coins + updated.coins_found
          else updated.captured_coins
        end::smallint as provisional_coins,
        updated.opened_bag_count,
        (updated.status <> 'active') as round_ended,
        case
          when updated.status = 'active' then null
          else updated.status
        end::text as end_reason,
        coalesce(updated.captured_coins, 0)::smallint as captured_coins,
        updated.elapsed_seconds,
        updated.coin_bag_hits,
        exists(select 1 from completed_participant) as participant_completed
      from updated_attempt updated
    ),
    retry_response as materialized (
      select
        'retry'::text as status,
        opened.challenge_date,
        opened.participant_id,
        opened.round_number,
        opened.bag_number,
        opened.open_order,
        opened.remaining_seconds_at_tap,
        case
          when opened.bag_number = placement.bomb_bag_number then 'bomb'
          when found.coins_found > 0 then 'coins'
          else 'empty'
        end::text as outcome,
        found.coins_found,
        case
          when coalesce(attempt.terminal_request_id = opened.request_id, false)
          then attempt.captured_coins
          else found.provisional_coins
        end::smallint as provisional_coins,
        opened.open_order as opened_bag_count,
        coalesce(attempt.terminal_request_id = opened.request_id, false)
          as round_ended,
        case
          when attempt.terminal_request_id = opened.request_id
          then attempt.status
          else null
        end::text as end_reason,
        case
          when attempt.terminal_request_id = opened.request_id
          then attempt.captured_coins
          else found.provisional_coins
        end::smallint as captured_coins,
        case
          when attempt.terminal_request_id = opened.request_id
          then attempt.elapsed_seconds
          else null
        end::smallint as elapsed_seconds,
        case
          when attempt.terminal_request_id = opened.request_id
          then attempt.coin_bag_hits
          else null
        end::smallint as coin_bag_hits,
        (
          attempt.terminal_request_id = opened.request_id
          and attempt.round_number = ${DAILY_CHALLENGE_ROUNDS}
          and participant.completed_at is not null
        ) as participant_completed
      from exact_retry opened
      inner join daily_challenge_round_attempts attempt
        on attempt.participant_id = opened.participant_id
        and attempt.challenge_date = opened.challenge_date
        and attempt.round_number = opened.round_number
      inner join daily_challenge_placements placement
        on placement.challenge_date = attempt.challenge_date
        and placement.round_number = attempt.challenge_round_number
      inner join daily_challenge_participants participant
        on participant.id = opened.participant_id
        and participant.challenge_date = opened.challenge_date
      cross join lateral (
        select
          count(*) filter (
            where coin_bag is not null and prior.open_order = opened.open_order
          )::smallint as coins_found,
          count(coin_bag)::smallint as provisional_coins
        from daily_challenge_round_opens prior
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
      case
        when exists(select 1 from locked_participant) then 'conflict'
        else 'unavailable'
      end,
      null, null, null, null, null, null, null, null, null, null, null, null,
      null, null, null, null
    where not exists(select 1 from new_response)
      and not exists(select 1 from retry_response)
  `)

  const row = result.rows[0]
  if (!row) throw new Error('DAILY OPEN response is missing.')
  if (row.status === 'unavailable' || row.status === 'conflict') {
    return { status: row.status }
  }
  if (
    row.challenge_date === null ||
    row.participant_id === null ||
    row.round_number === null ||
    row.bag_number === null ||
    row.open_order === null ||
    row.remaining_seconds_at_tap === null ||
    row.outcome === null ||
    row.coins_found === null ||
    row.provisional_coins === null ||
    row.opened_bag_count === null ||
    row.round_ended === null ||
    row.captured_coins === null ||
    row.participant_completed === null
  ) {
    throw new Error('DAILY OPEN response is inconsistent.')
  }

  return {
    status: row.status,
    view: {
      challengeDate: row.challenge_date,
      participantId: row.participant_id,
      roundNumber: row.round_number,
      bagNumber: row.bag_number,
      openOrder: row.open_order,
      remainingSecondsAtTap: row.remaining_seconds_at_tap,
      outcome: row.outcome,
      coinsFound: row.coins_found as 0 | 1 | 2 | 3,
      provisionalCoins: row.provisional_coins as 0 | 1 | 2 | 3,
      openedBagCount: row.opened_bag_count,
      roundEnded: row.round_ended,
      endReason: row.end_reason,
      capturedCoins: row.captured_coins as 0 | 1 | 2 | 3,
      elapsedSeconds: row.elapsed_seconds,
      coinBagHits: row.coin_bag_hits,
      participantCompleted: row.participant_completed,
    },
  }
}
