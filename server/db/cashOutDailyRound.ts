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

export interface DailyCashOutView {
  readonly challengeDate: DailyChallengeDate
  readonly participantId: string
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly elapsedSeconds: number
  readonly coinBagHits: number
  readonly remainingSecondsAtTap: number
  readonly participantCompleted: boolean
}

export type CashOutDailyRoundResult =
  | { readonly status: 'cashed_out' | 'retry'; readonly view: DailyCashOutView }
  | { readonly status: 'unavailable' | 'conflict' }

interface Row extends Record<string, unknown> {
  readonly status: 'cashed_out' | 'retry' | 'unavailable' | 'conflict'
  readonly challenge_date: string | null
  readonly participant_id: string | null
  readonly round_number: number | null
  readonly captured_coins: number | null
  readonly opened_bag_count: number | null
  readonly elapsed_seconds: number | null
  readonly coin_bag_hits: number | null
  readonly remaining_seconds_at_tap: number | null
  readonly participant_completed: boolean | null
}

function asOfExpression(nowMs: number | undefined) {
  if (nowMs === undefined) return sql`statement_timestamp()`
  return sql`${new Date(nowMs).toISOString()}::timestamptz`
}

/**
 * Atomically cashes out an active DAILY ROUND under the participant row lock.
 * Same TIME OUT / UTC-day finalize ordering as OPEN. Requires provisional
 * coins of 1 or 2 (never 0 or 3). Does not award 3COINS COMPLETE.
 */
export async function cashOutDailyRound(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  readonly requestId: string
  readonly remainingSecondsAtTap: number
  /** Test seam — defaults to database `statement_timestamp()`. */
  readonly nowMs?: number
}): Promise<CashOutDailyRoundResult> {
  void dailyChallengePeriod(input.challengeDate)
  try {
    dailyElapsedSecondsAtTap(input.remainingSecondsAtTap)
  } catch {
    return { status: 'conflict' }
  }

  const asOf = asOfExpression(input.nowMs)
  const elapsedSeconds = dailyElapsedSecondsAtTap(input.remainingSecondsAtTap)
  const result = await getDatabase().execute<Row>(sql`
    with params as materialized (
      select
        ${input.challengeDate}::date as challenge_date,
        ${input.authTokenHash} as auth_token_hash,
        ${input.requestId}::uuid as request_id,
        ${input.remainingSecondsAtTap}::smallint as remaining_seconds_at_tap,
        ${elapsedSeconds}::smallint as elapsed_seconds,
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
        params.remaining_seconds_at_tap,
        params.elapsed_seconds
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
    exact_retry as materialized (
      select
        attempt.*,
        (
          ${DAILY_ROUND_LIMIT_SECONDS} - attempt.elapsed_seconds
        )::smallint as replay_remaining_seconds
      from daily_challenge_round_attempts attempt
      inner join locked_participant locked
        on locked.id = attempt.participant_id
        and locked.challenge_date = attempt.challenge_date
      where attempt.terminal_request_id = locked.request_id
        and attempt.status = 'cashed_out'
    ),
    target as materialized (
      select
        locked.id as participant_id,
        locked.challenge_date,
        locked.now_ts,
        locked.challenge_ends_at,
        locked.request_id,
        locked.remaining_seconds_at_tap,
        locked.elapsed_seconds,
        attempt.round_number,
        attempt.started_at,
        attempt.opened_bag_count,
        placement.coin_bag_numbers,
        placement.bomb_bag_number,
        (
          locked.remaining_seconds_at_tap between 1 and ${DAILY_ROUND_LIMIT_SECONDS}
          and locked.now_ts < locked.challenge_ends_at
          and locked.now_ts >= attempt.started_at
            + make_interval(secs => locked.elapsed_seconds)
          and locked.now_ts < attempt.started_at
            + make_interval(
              secs => locked.elapsed_seconds + 1 + ${DAILY_OPERATION_GRACE_SECONDS}
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
    ),
    summary as materialized (
      select
        target.participant_id,
        target.challenge_date,
        target.round_number,
        target.now_ts,
        target.request_id,
        target.remaining_seconds_at_tap,
        target.elapsed_seconds,
        target.timing_ok,
        count(distinct opened.open_order)::smallint as opened_bag_count,
        min(opened.open_order)::smallint as first_open_order,
        max(opened.open_order)::smallint as last_open_order,
        count(coin_bag)::smallint as provisional_coins,
        count(distinct opened.open_order) filter (
          where opened.bag_number = any (target.coin_bag_numbers)
        )::smallint as coin_bag_hits,
        coalesce(
          bool_or(opened.bag_number = target.bomb_bag_number),
          false
        ) as bomb_opened
      from target
      left join daily_challenge_round_opens opened
        on opened.participant_id = target.participant_id
        and opened.round_number = target.round_number
      left join lateral unnest(target.coin_bag_numbers) coin_bag
        on coin_bag = opened.bag_number
      group by
        target.participant_id,
        target.challenge_date,
        target.round_number,
        target.now_ts,
        target.request_id,
        target.remaining_seconds_at_tap,
        target.elapsed_seconds,
        target.timing_ok
    ),
    updated_attempt as (
      update daily_challenge_round_attempts attempt
      set
        status = 'cashed_out',
        captured_coins = summary.provisional_coins,
        opened_bag_count = summary.opened_bag_count,
        coin_bag_hits = summary.coin_bag_hits,
        elapsed_seconds = summary.elapsed_seconds,
        ended_at = summary.now_ts,
        terminal_request_id = summary.request_id,
        version = attempt.version + 1
      from summary
      where attempt.participant_id = summary.participant_id
        and attempt.challenge_date = summary.challenge_date
        and attempt.round_number = summary.round_number
        and attempt.status = 'active'
        and summary.timing_ok
        and summary.provisional_coins in (1, 2)
        and not summary.bomb_opened
        and summary.opened_bag_count > 0
        and summary.first_open_order = 1
        and summary.last_open_order = summary.opened_bag_count
        and not exists (select 1 from exact_retry)
      returning attempt.*, summary.remaining_seconds_at_tap
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
        and updated.round_number = ${DAILY_CHALLENGE_ROUNDS}
        and participant.completed_at is null
        and participant.expired_at is null
        and updated.ended_at < (
          updated.challenge_date::timestamp at time zone 'UTC' + interval '1 day'
        )
      returning participant.id
    ),
    response as materialized (
      select
        'cashed_out'::text as status,
        updated.challenge_date,
        updated.participant_id,
        updated.round_number,
        updated.captured_coins,
        updated.opened_bag_count,
        updated.elapsed_seconds,
        updated.coin_bag_hits,
        updated.remaining_seconds_at_tap,
        exists(select 1 from completed_participant) as participant_completed
      from updated_attempt updated
      union all
      select
        'retry'::text,
        retry.challenge_date,
        retry.participant_id,
        retry.round_number,
        retry.captured_coins,
        retry.opened_bag_count,
        retry.elapsed_seconds,
        retry.coin_bag_hits,
        retry.replay_remaining_seconds,
        (
          retry.round_number = ${DAILY_CHALLENGE_ROUNDS}
          and participant.completed_at is not null
        ) as participant_completed
      from exact_retry retry
      inner join daily_challenge_participants participant
        on participant.id = retry.participant_id
        and participant.challenge_date = retry.challenge_date
    )
    select * from response
    union all
    select
      case
        when exists(select 1 from locked_participant) then 'conflict'
        else 'unavailable'
      end,
      null, null, null, null, null, null, null, null, null
    where not exists(select 1 from response)
  `)

  const row = result.rows[0]
  if (!row) throw new Error('DAILY CASH OUT response is missing.')
  if (row.status === 'unavailable' || row.status === 'conflict') {
    return { status: row.status }
  }
  if (
    row.challenge_date === null ||
    row.participant_id === null ||
    row.round_number === null ||
    (row.captured_coins !== 1 && row.captured_coins !== 2) ||
    row.opened_bag_count === null ||
    row.elapsed_seconds === null ||
    row.coin_bag_hits === null ||
    row.remaining_seconds_at_tap === null ||
    row.participant_completed === null
  ) {
    throw new Error('DAILY CASH OUT response is inconsistent.')
  }

  return {
    status: row.status,
    view: {
      challengeDate: row.challenge_date,
      participantId: row.participant_id,
      roundNumber: row.round_number,
      endReason: 'cashed_out',
      capturedCoins: row.captured_coins,
      openedBagCount: row.opened_bag_count,
      elapsedSeconds: row.elapsed_seconds,
      coinBagHits: row.coin_bag_hits,
      remainingSecondsAtTap: row.remaining_seconds_at_tap,
      participantCompleted: row.participant_completed,
    },
  }
}
