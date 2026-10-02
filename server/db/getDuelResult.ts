import { sql } from 'drizzle-orm'
import {
  aggregateDuelParticipantResult,
  compareDuelParticipantResults,
  DuelResultDataError,
  pairDuelParticipantResults,
  type DuelParticipantResultInput,
  type DuelParticipantResultSummary,
  type DuelResultEndReason,
  type DuelResultRole,
  type DuelResultWinner,
} from '../duel/duelResult.js'
import { getDatabase } from './client.js'

export interface GetDuelResultInput {
  readonly matchId: string
  readonly participantTokenHash: string
}

export type PersistedDuelResult =
  | {
      readonly matchId: string
      readonly status: 'waiting'
      readonly selfCompleted: boolean
      readonly opponentCompleted: boolean
    }
  | {
      readonly matchId: string
      readonly status: 'completed'
      readonly viewerRole: DuelResultRole
      readonly totalRounds: number
      readonly winner: DuelResultWinner
      readonly participants: Readonly<
        Record<DuelResultRole, DuelParticipantResultSummary>
      >
    }

interface DuelResultRow extends Record<string, unknown> {
  readonly match_id: string
  readonly viewer_role: DuelResultRole
  readonly total_rounds: number
  readonly self_completed: boolean
  readonly opponent_completed: boolean
  readonly progress_integrity_ok: boolean
  readonly result_data: unknown
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DuelResultDataError()
  }
  return value as Record<string, unknown>
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new DuelResultDataError()
  return value
}

function integer(value: unknown): number {
  if (!Number.isInteger(value)) throw new DuelResultDataError()
  return value as number
}

function role(value: unknown): DuelResultRole {
  if (value !== 'A' && value !== 'B') throw new DuelResultDataError()
  return value
}

function participantInput(
  value: unknown,
  expectedRole: DuelResultRole,
  totalRounds: number,
): DuelParticipantResultInput {
  const participant = record(value)
  if (role(participant.role) !== expectedRole) throw new DuelResultDataError()
  const placements = array(participant.opponentPlacements).map((entry) => {
    const placement = record(entry)
    return {
      roundNumber: integer(placement.roundNumber),
      bagCount: integer(placement.bagCount),
      bombBagNumber: integer(placement.bombBagNumber),
      coinBagNumbers: array(placement.coinBagNumbers).map(integer),
    }
  })
  const rounds = array(participant.rounds).map((entry) => {
    const round = record(entry)
    if (!['bombed', 'cashed_out', 'cleared'].includes(round.endReason as string)) {
      throw new DuelResultDataError()
    }
    if (typeof round.bombHit !== 'boolean') throw new DuelResultDataError()
    return {
      roundNumber: integer(round.roundNumber),
      placementRole: role(round.placementRole),
      endReason: round.endReason as DuelResultEndReason,
      capturedCoins: integer(round.capturedCoins),
      bombHit: round.bombHit,
      openedBagCount: integer(round.openedBagCount),
      opens: array(round.opens).map((entry) => {
        const opened = record(entry)
        return {
          openOrder: integer(opened.openOrder),
          bagNumber: integer(opened.bagNumber),
        }
      }),
    }
  })
  return {
    role: expectedRole,
    totalRounds,
    opponentPlacements: placements,
    rounds,
  }
}

/** Authenticates and reads completion/result data in one PostgreSQL statement snapshot. */
export async function getDuelResultForParticipant(
  input: GetDuelResultInput,
): Promise<PersistedDuelResult | null> {
  const result = await getDatabase().execute<DuelResultRow>(sql`
    with candidate as materialized (
      select
        match.id as match_id,
        match.total_rounds,
        self.role as viewer_role,
        opponent.role as opponent_role
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
        and (match.expires_at is null or match.expires_at > statement_timestamp())
    ), role_progress as materialized (
      select
        participant.role,
        count(result.*)::integer as result_count,
        count(distinct result.round_number)::integer as distinct_result_count,
        min(result.round_number)::integer as first_round,
        max(result.round_number)::integer as last_round
      from candidate
      inner join duel_participants participant
        on participant.match_id = candidate.match_id
      left join duel_round_results result
        on result.match_id = candidate.match_id
        and result.explorer_role = participant.role
      group by participant.role
    ), completion as materialized (
      select
        candidate.*,
        coalesce(bool_and(
          role_progress.result_count between 0 and candidate.total_rounds
          and role_progress.result_count = role_progress.distinct_result_count
          and (
            role_progress.result_count = 0
            or (
              role_progress.first_round = 1
              and role_progress.last_round = role_progress.result_count
            )
          )
        ), false) as progress_integrity_ok,
        coalesce(bool_and(role_progress.result_count = candidate.total_rounds), false)
          as both_completed,
        coalesce(bool_and(role_progress.result_count = candidate.total_rounds)
          filter (where role_progress.role = candidate.viewer_role), false)
          as self_completed,
        coalesce(bool_and(role_progress.result_count = candidate.total_rounds)
          filter (where role_progress.role = candidate.opponent_role), false)
          as opponent_completed
      from candidate
      inner join role_progress on true
      group by
        candidate.match_id,
        candidate.total_rounds,
        candidate.viewer_role,
        candidate.opponent_role
    ), completed_data as materialized (
      select jsonb_object_agg(
        participant.role,
        jsonb_build_object(
          'role', participant.role,
          'opponentPlacements', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'roundNumber', placement.round_number,
              'bagCount', placement.bag_count,
              'bombBagNumber', placement.bomb_bag_number,
              'coinBagNumbers', placement.coin_bag_numbers
            ) order by placement.round_number), '[]'::jsonb)
            from duel_round_placements placement
            where placement.match_id = completion.match_id
              and placement.participant_role <> participant.role
          ),
          'rounds', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'roundNumber', settled.round_number,
              'placementRole', settled.placement_role,
              'endReason', settled.end_reason,
              'capturedCoins', settled.captured_coins,
              'bombHit', settled.bomb_hit,
              'openedBagCount', settled.opened_bag_count,
              'opens', (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'openOrder', opened.open_order,
                  'bagNumber', opened.bag_number
                ) order by opened.open_order), '[]'::jsonb)
                from duel_round_opens opened
                where opened.match_id = settled.match_id
                  and opened.explorer_role = settled.explorer_role
                  and opened.round_number = settled.round_number
              )
            ) order by settled.round_number), '[]'::jsonb)
            from duel_round_results settled
            where settled.match_id = completion.match_id
              and settled.explorer_role = participant.role
          )
        )
      ) as result_data
      from completion
      inner join duel_participants participant
        on participant.match_id = completion.match_id
      where completion.both_completed and completion.progress_integrity_ok
      group by completion.match_id
    )
    select
      completion.match_id,
      completion.viewer_role,
      completion.total_rounds,
      completion.self_completed,
      completion.opponent_completed,
      completion.progress_integrity_ok,
      completed_data.result_data
    from completion
    left join completed_data on true
  `)

  const row = result.rows[0]
  if (!row) return null
  if (!row.progress_integrity_ok) throw new DuelResultDataError()
  if (!row.self_completed || !row.opponent_completed) {
    return {
      matchId: row.match_id,
      status: 'waiting',
      selfCompleted: row.self_completed,
      opponentCompleted: row.opponent_completed,
    }
  }

  const data = record(row.result_data)
  const participants = pairDuelParticipantResults(
    aggregateDuelParticipantResult(
      participantInput(data.A, 'A', row.total_rounds),
    ),
    aggregateDuelParticipantResult(
      participantInput(data.B, 'B', row.total_rounds),
    ),
  )
  return {
    matchId: row.match_id,
    status: 'completed',
    viewerRole: row.viewer_role,
    totalRounds: row.total_rounds,
    winner: compareDuelParticipantResults(participants.A, participants.B),
    participants,
  }
}
