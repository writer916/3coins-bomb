import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelPlacementRole = 'A' | 'B'

export interface CanonicalDuelRoundPlacement {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface LockDuelPlacementsInput {
  readonly matchId: string
  readonly participantTokenHash: string
  readonly placements: readonly CanonicalDuelRoundPlacement[]
}

export type LockDuelPlacementsStatus =
  | 'locked'
  | 'retry'
  | 'invalid'
  | 'conflict'
  | 'unavailable'

export interface LockDuelPlacementsResult {
  readonly status: LockDuelPlacementsStatus
  readonly role?: DuelPlacementRole
}

interface LockDuelPlacementsRow extends Record<string, unknown> {
  readonly status: LockDuelPlacementsStatus
  readonly role: DuelPlacementRole | null
}

/**
 * Inserts every ROUND and marks the participant locked in one SQL statement.
 * The participant row lock serializes first LOCK, retry, and conflicting LOCKs.
 */
export async function persistLockedDuelPlacements(
  input: LockDuelPlacementsInput,
): Promise<LockDuelPlacementsResult> {
  const encodedPlacements = JSON.stringify(
    input.placements.map((placement) => ({
      round_number: placement.roundNumber,
      bag_count: placement.bagCount,
      bomb_bag_number: placement.bombBagNumber,
      coin_bag_numbers: placement.coinBagNumbers,
    })),
  )

  const result = await getDatabase().execute<LockDuelPlacementsRow>(sql`
    with candidate as materialized (
      select
        participant.match_id,
        participant.role,
        participant.placement_locked_at,
        match.total_rounds
      from duel_participants participant
      inner join duel_matches match on match.id = participant.match_id
      where participant.match_id = ${input.matchId}::uuid
        and participant.auth_token_hash = ${input.participantTokenHash}
        and participant.claimed_at is not null
        and (
          match.expires_at is null
          or match.expires_at > statement_timestamp()
        )
      for update of participant
    ), incoming as materialized (
      select *
      from jsonb_to_recordset(${encodedPlacements}::jsonb) as placement(
        round_number smallint,
        bag_count smallint,
        bomb_bag_number smallint,
        coin_bag_numbers smallint[]
      )
    ), input_valid as (
      select exists (
        select 1
        from candidate
        where (select count(*) from incoming) = candidate.total_rounds
          and (select count(distinct round_number) from incoming) = candidate.total_rounds
          and (select min(round_number) from incoming) = 1
          and (select max(round_number) from incoming) = candidate.total_rounds
      ) as valid
    ), inserted as (
      insert into duel_round_placements (
        match_id,
        participant_role,
        round_number,
        bag_count,
        bomb_bag_number,
        coin_bag_numbers,
        locked_at
      )
      select
        candidate.match_id,
        candidate.role,
        incoming.round_number,
        incoming.bag_count,
        incoming.bomb_bag_number,
        incoming.coin_bag_numbers,
        statement_timestamp()
      from candidate
      cross join incoming
      cross join input_valid
      where candidate.placement_locked_at is null
        and input_valid.valid
        and not exists (
          select 1
          from duel_round_placements existing
          where existing.match_id = candidate.match_id
            and existing.participant_role = candidate.role
        )
      returning match_id
    ), locked as (
      update duel_participants participant
      set
        placement_locked_at = statement_timestamp(),
        version = participant.version + 1
      from candidate
      where participant.match_id = candidate.match_id
        and participant.role = candidate.role
        and candidate.placement_locked_at is null
        and (select count(*) from inserted) = candidate.total_rounds
      returning participant.role
    ), exact_retry as (
      select candidate.role
      from candidate
      cross join input_valid
      where candidate.placement_locked_at is not null
        and input_valid.valid
        and (
          select count(*)
          from duel_round_placements stored
          where stored.match_id = candidate.match_id
            and stored.participant_role = candidate.role
        ) = candidate.total_rounds
        and not exists (
          select 1
          from incoming
          left join duel_round_placements stored
            on stored.match_id = candidate.match_id
            and stored.participant_role = candidate.role
            and stored.round_number = incoming.round_number
            and stored.bag_count = incoming.bag_count
            and stored.bomb_bag_number = incoming.bomb_bag_number
            and stored.coin_bag_numbers = incoming.coin_bag_numbers
          where stored.round_number is null
        )
    )
    select
      case
        when not exists (select 1 from candidate) then 'unavailable'
        when exists (select 1 from locked) then 'locked'
        when exists (select 1 from exact_retry) then 'retry'
        when not (select valid from input_valid) then 'invalid'
        else 'conflict'
      end as status,
      (select role from candidate) as role
  `)

  const row = result.rows[0]
  if (!row) throw new Error('DUEL placement LOCK did not return a status.')
  return row.role === null
    ? { status: row.status }
    : { status: row.status, role: row.role }
}
