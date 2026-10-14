import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import { DAILY_CHALLENGE_ROUNDS } from '../../src/daily/dailyQuestionSet.js'
import {
  dailyChallengePeriod,
  dailyRoundUiDeadlineMs,
  DAILY_OPERATION_GRACE_SECONDS,
  DAILY_ROUND_LIMIT_SECONDS,
} from '../../src/daily/dailyTime.js'
import { getDatabase } from './client.js'

/** Grace after UI zero before irreversible TIME OUT (matches dailyTime helpers). */
const TIMEOUT_FINALIZE_SECONDS =
  DAILY_ROUND_LIMIT_SECONDS + DAILY_OPERATION_GRACE_SECONDS

export interface DailyOpenSummary {
  readonly openOrder: number
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
  readonly openedAt: string
}

export interface DailyActiveAttemptView {
  readonly roundNumber: number
  readonly startedAt: string
  readonly deadlineAt: string
  readonly openedBagCount: number
  /** Formation size only — never bomb/coin placement. */
  readonly bagCount: number
  readonly opens: readonly DailyOpenSummary[]
}

export interface PersistedDailyPlayState {
  readonly challengeDate: DailyChallengeDate
  readonly serverNow: string
  readonly challengeEndsAt: string
  readonly participantId: string
  readonly displayNickname: string
  readonly completedAt: string | null
  readonly expiredAt: string | null
  readonly completedRounds: number
  readonly nextRoundNumber: number | null
  readonly activeAttempt: DailyActiveAttemptView | null
}

export type DailyStartRejectReason =
  | 'not_found'
  | 'already_active'
  | 'completed'
  | 'expired'
  | 'challenge_ended'
  | 'rounds_exhausted'

export type StartDailyRoundResult =
  | { readonly status: 'started'; readonly state: PersistedDailyPlayState }
  | { readonly status: 'replayed'; readonly state: PersistedDailyPlayState }
  | {
      readonly status: 'rejected'
      readonly reason: DailyStartRejectReason
      readonly state: PersistedDailyPlayState | null
    }

interface MutationFlagsRow extends Record<string, unknown> {
  readonly participant_found: boolean
  readonly inserted: boolean
  readonly replayed: boolean
  readonly already_active: boolean
  readonly was_completed: boolean
  readonly was_expired: boolean
  readonly challenge_ended: boolean
  readonly rounds_exhausted: boolean
}

interface StateRow extends Record<string, unknown> {
  readonly challenge_date: string
  readonly server_now: Date | string
  readonly challenge_ends_at: Date | string
  readonly participant_id: string
  readonly display_nickname: string
  readonly completed_at: Date | string | null
  readonly expired_at: Date | string | null
  readonly terminal_count: number
  readonly terminal_first: number | null
  readonly terminal_last: number | null
  readonly active_count: number
  readonly active_round: number | null
  readonly active_started_at: Date | string | null
  readonly active_opened_bag_count: number | null
  readonly active_bag_count: number | null
  readonly active_opens: unknown
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function asIso(value: Date | string): string {
  return new Date(value).toISOString()
}

function parseOpens(value: unknown): DailyOpenSummary[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const row = entry as Record<string, unknown>
    return {
      openOrder: Number(row.openOrder),
      bagNumber: Number(row.bagNumber),
      remainingSecondsAtTap: Number(row.remainingSecondsAtTap),
      openedAt: asIso(row.openedAt as Date | string),
    }
  })
}

function toState(row: StateRow): PersistedDailyPlayState {
  const terminalCount = Number(row.terminal_count)
  const activeCount = Number(row.active_count)
  const contiguous =
    terminalCount === 0 ||
    (Number(row.terminal_first) === 1 &&
      Number(row.terminal_last) === terminalCount)
  if (
    !contiguous ||
    terminalCount < 0 ||
    terminalCount > DAILY_CHALLENGE_ROUNDS ||
    activeCount < 0 ||
    activeCount > 1 ||
    (activeCount === 1 && Number(row.active_round) !== terminalCount + 1)
  ) {
    throw new Error('DAILY play state is inconsistent.')
  }

  const completedAt = optionalIso(row.completed_at)
  const expiredAt = optionalIso(row.expired_at)
  const finished = completedAt !== null || expiredAt !== null

  let activeAttempt: DailyActiveAttemptView | null = null
  if (activeCount === 1) {
    const startedAt = asIso(row.active_started_at!)
    const startedAtMs = Date.parse(startedAt)
    activeAttempt = {
      roundNumber: Number(row.active_round),
      startedAt,
      deadlineAt: new Date(dailyRoundUiDeadlineMs(startedAtMs)).toISOString(),
      openedBagCount: Number(row.active_opened_bag_count),
      bagCount: Number(row.active_bag_count),
      opens: parseOpens(row.active_opens),
    }
  }

  return {
    challengeDate: row.challenge_date,
    serverNow: asIso(row.server_now),
    challengeEndsAt: asIso(row.challenge_ends_at),
    participantId: row.participant_id,
    displayNickname: row.display_nickname,
    completedAt,
    expiredAt,
    completedRounds: terminalCount,
    nextRoundNumber: finished
      ? null
      : (activeAttempt?.roundNumber ?? terminalCount + 1),
    activeAttempt,
  }
}

function asOfExpression(nowMs: number | undefined) {
  if (nowMs === undefined) return sql`statement_timestamp()`
  return sql`${new Date(nowMs).toISOString()}::timestamptz`
}

/**
 * Participant-locked side effects in one statement (visible to later statements
 * once this query returns). TIME OUT waits until UI deadline + delivery grace,
 * except UTC day end which finalizes immediately.
 */
async function applyDailyPlaySideEffects(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  readonly nowMs?: number
}): Promise<boolean> {
  const asOf = asOfExpression(input.nowMs)
  const result = await getDatabase().execute<{ found: boolean }>(sql`
    with params as materialized (
      select
        ${input.challengeDate}::date as challenge_date,
        ${input.authTokenHash} as auth_token_hash,
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
        params.challenge_ends_at
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
    completed_participant as (
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
    expired_participant as (
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
        and not exists (select 1 from completed_participant)
      returning participant.id
    )
    select exists(select 1 from locked_participant) as found
  `)
  return result.rows[0]?.found === true
}

async function readDailyPlayState(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  readonly nowMs?: number
}): Promise<PersistedDailyPlayState | null> {
  const asOf = asOfExpression(input.nowMs)
  const result = await getDatabase().execute<StateRow>(sql`
    with params as materialized (
      select
        ${input.challengeDate}::date as challenge_date,
        ${input.authTokenHash} as auth_token_hash,
        ${asOf} as now_ts,
        (${input.challengeDate}::timestamp at time zone 'UTC' + interval '1 day')
          as challenge_ends_at
    )
    select
      participant.challenge_date,
      params.now_ts as server_now,
      params.challenge_ends_at,
      participant.id as participant_id,
      participant.display_nickname,
      participant.completed_at,
      participant.expired_at,
      count(attempt.*) filter (
        where attempt.status <> 'active'
      )::integer as terminal_count,
      min(attempt.round_number) filter (
        where attempt.status <> 'active'
      )::integer as terminal_first,
      max(attempt.round_number) filter (
        where attempt.status <> 'active'
      )::integer as terminal_last,
      count(attempt.*) filter (
        where attempt.status = 'active'
      )::integer as active_count,
      min(attempt.round_number) filter (
        where attempt.status = 'active'
      )::integer as active_round,
      min(attempt.started_at) filter (
        where attempt.status = 'active'
      ) as active_started_at,
      min(attempt.opened_bag_count) filter (
        where attempt.status = 'active'
      )::integer as active_opened_bag_count,
      min(placement.bag_count) filter (
        where attempt.status = 'active'
      )::integer as active_bag_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'openOrder', open_row.open_order,
            'bagNumber', open_row.bag_number,
            'remainingSecondsAtTap', open_row.remaining_seconds_at_tap,
            'openedAt', open_row.opened_at
          )
          order by open_row.open_order
        )
        from daily_challenge_round_opens open_row
        where open_row.participant_id = participant.id
          and open_row.round_number = (
            select active_attempt.round_number
            from daily_challenge_round_attempts active_attempt
            where active_attempt.participant_id = participant.id
              and active_attempt.challenge_date = participant.challenge_date
              and active_attempt.status = 'active'
            limit 1
          )
      ), '[]'::jsonb) as active_opens
    from daily_challenge_participants participant
    inner join params
      on params.challenge_date = participant.challenge_date
      and params.auth_token_hash = participant.auth_token_hash
    left join daily_challenge_round_attempts attempt
      on attempt.participant_id = participant.id
      and attempt.challenge_date = participant.challenge_date
    left join daily_challenge_placements placement
      on placement.challenge_date = attempt.challenge_date
      and placement.round_number = attempt.challenge_round_number
      and attempt.status = 'active'
    group by
      participant.challenge_date,
      params.now_ts,
      params.challenge_ends_at,
      participant.id,
      participant.display_nickname,
      participant.completed_at,
      participant.expired_at
  `)
  const row = result.rows[0]
  return row ? toState(row) : null
}

/**
 * Loads DAILY play state after applying eligible TIME OUT / expiry / completion.
 * Never returns bomb or coin bag placements.
 */
export async function getDailyPlayState(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  /** Test seam — defaults to database `statement_timestamp()`. */
  readonly nowMs?: number
}): Promise<PersistedDailyPlayState | null> {
  void dailyChallengePeriod(input.challengeDate)
  const found = await applyDailyPlaySideEffects(input)
  if (!found) return null
  return readDailyPlayState(input)
}

/**
 * Atomically starts the next contiguous ROUND (1..20). Serializes on
 * `FOR UPDATE` of the participant row; `start_request_id` is idempotent.
 */
export async function startDailyRound(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
  readonly startRequestId: string
  readonly nowMs?: number
}): Promise<StartDailyRoundResult> {
  void dailyChallengePeriod(input.challengeDate)
  await applyDailyPlaySideEffects(input)

  const asOf = asOfExpression(input.nowMs)
  const flags = await getDatabase().execute<MutationFlagsRow>(sql`
    with params as materialized (
      select
        ${input.challengeDate}::date as challenge_date,
        ${input.authTokenHash} as auth_token_hash,
        ${asOf} as now_ts,
        (${input.challengeDate}::timestamp at time zone 'UTC' + interval '1 day')
          as challenge_ends_at
    ),
    locked_participant as materialized (
      select
        participant.id,
        participant.challenge_date,
        participant.question_order,
        participant.completed_at,
        participant.expired_at,
        params.now_ts,
        params.challenge_ends_at
      from daily_challenge_participants participant
      inner join params
        on params.challenge_date = participant.challenge_date
        and params.auth_token_hash = participant.auth_token_hash
      for update of participant
    ),
    progress as materialized (
      select
        locked.id as participant_id,
        locked.challenge_date,
        locked.question_order,
        locked.completed_at,
        locked.expired_at,
        locked.now_ts,
        locked.challenge_ends_at,
        count(attempt.*) filter (
          where attempt.status <> 'active'
        )::integer as terminal_count,
        count(attempt.*) filter (
          where attempt.status = 'active'
        )::integer as active_count
      from locked_participant locked
      left join daily_challenge_round_attempts attempt
        on attempt.participant_id = locked.id
        and attempt.challenge_date = locked.challenge_date
      group by
        locked.id,
        locked.challenge_date,
        locked.question_order,
        locked.completed_at,
        locked.expired_at,
        locked.now_ts,
        locked.challenge_ends_at
    ),
    inserted as (
      insert into daily_challenge_round_attempts (
        participant_id,
        challenge_date,
        round_number,
        challenge_round_number,
        status,
        started_at,
        opened_bag_count,
        start_request_id,
        version
      )
      select
        progress.participant_id,
        progress.challenge_date,
        progress.terminal_count + 1,
        progress.question_order[progress.terminal_count + 1],
        'active',
        progress.now_ts,
        0,
        ${input.startRequestId}::uuid,
        0
      from progress
      where progress.active_count = 0
        and progress.terminal_count < ${DAILY_CHALLENGE_ROUNDS}
        and progress.completed_at is null
        and progress.expired_at is null
        and progress.now_ts < progress.challenge_ends_at
      on conflict (start_request_id) do nothing
      returning participant_id, round_number, start_request_id
    ),
    replay as materialized (
      select attempt.participant_id
      from daily_challenge_round_attempts attempt
      inner join locked_participant locked on locked.id = attempt.participant_id
      where attempt.start_request_id = ${input.startRequestId}::uuid
        and attempt.status = 'active'
    )
    select
      exists(select 1 from locked_participant) as participant_found,
      exists(select 1 from inserted) as inserted,
      (
        exists(select 1 from replay)
        and not exists(select 1 from inserted)
      ) as replayed,
      exists(
        select 1 from progress where progress.active_count > 0
      )
        and not exists(select 1 from inserted)
        and not exists(select 1 from replay) as already_active,
      exists(
        select 1 from locked_participant where completed_at is not null
      ) as was_completed,
      exists(
        select 1 from locked_participant where expired_at is not null
      ) as was_expired,
      exists(
        select 1 from locked_participant locked
        where locked.now_ts >= locked.challenge_ends_at
          and locked.completed_at is null
      ) as challenge_ended,
      exists(
        select 1 from progress
        where progress.terminal_count >= ${DAILY_CHALLENGE_ROUNDS}
          and progress.active_count = 0
      ) as rounds_exhausted
  `)

  const row = flags.rows[0]
  if (!row?.participant_found) {
    return { status: 'rejected', reason: 'not_found', state: null }
  }

  const state = await readDailyPlayState(input)

  if (row.inserted) {
    if (!state) {
      throw new Error('DAILY round start succeeded without readable state.')
    }
    return { status: 'started', state }
  }
  if (row.replayed) {
    if (!state) {
      throw new Error('DAILY round replay missing readable state.')
    }
    return { status: 'replayed', state }
  }
  if (row.was_completed) {
    return { status: 'rejected', reason: 'completed', state }
  }
  if (row.was_expired || row.challenge_ended) {
    return {
      status: 'rejected',
      reason: row.was_expired ? 'expired' : 'challenge_ended',
      state,
    }
  }
  if (row.already_active) {
    return { status: 'rejected', reason: 'already_active', state }
  }
  if (row.rounds_exhausted) {
    return { status: 'rejected', reason: 'rounds_exhausted', state }
  }
  return { status: 'rejected', reason: 'challenge_ended', state }
}
