import { sql } from 'drizzle-orm'
import {
  GROUP_FORMATION_VERSION,
  GROUP_RULE_VERSION,
  GROUP_SCORING_VERSION,
  type GroupPlacementCandidate,
} from '../../src/group/groupDomain.js'
import { getDatabase } from './client.js'

export interface PersistGroupMatchInput {
  readonly createRequestId: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly invitationTokenHash: string
  readonly hostTokenHash: string
  readonly placements: readonly GroupPlacementCandidate[]
}

export interface PersistedGroupMatch {
  readonly groupId: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly createdAt: string
  readonly expiresAt: null
  readonly formationVersion: typeof GROUP_FORMATION_VERSION
  readonly ruleVersion: typeof GROUP_RULE_VERSION
  readonly scoringVersion: typeof GROUP_SCORING_VERSION
  readonly created: boolean
}

interface PersistedGroupMatchRow extends Record<string, unknown> {
  readonly group_id: string
  readonly total_rounds: number
  readonly player_limit: number
  readonly created_at: Date | string
  readonly expires_at: null
  readonly formation_version: number
  readonly rule_version: number
  readonly scoring_version: number
  readonly created: boolean
  readonly atomic_guard: number
}

/** Atomically inserts a GROUP and every immutable ROUND placement. */
export async function persistGroupMatch(
  input: PersistGroupMatchInput,
): Promise<PersistedGroupMatch | null> {
  const placementRows = input.placements.map(({ origin, placement }) => ({
    round_number: placement.roundNumber,
    bag_count: placement.bagCount,
    bomb_bag_number: placement.bombBagNumber,
    coin_bag_numbers: placement.coinBagNumbers,
    source: origin,
  }))
  const result = await getDatabase().execute<PersistedGroupMatchRow>(sql`
    with match_row as materialized (
      insert into group_matches (
        total_rounds,
        player_limit,
        status,
        create_request_id,
        invite_token_hash,
        host_token_hash,
        host_participant_id,
        closed_at,
        expires_at,
        formation_version,
        rule_version,
        scoring_version
      ) values (
        ${input.totalRounds},
        ${input.playerLimit},
        'open',
        ${input.createRequestId}::uuid,
        ${input.invitationTokenHash},
        ${input.hostTokenHash},
        null,
        null,
        null,
        ${GROUP_FORMATION_VERSION},
        ${GROUP_RULE_VERSION},
        ${GROUP_SCORING_VERSION}
      )
      on conflict (create_request_id) do update
      set create_request_id = excluded.create_request_id
      where group_matches.total_rounds = excluded.total_rounds
        and group_matches.player_limit = excluded.player_limit
        and group_matches.invite_token_hash = excluded.invite_token_hash
        and group_matches.host_token_hash = excluded.host_token_hash
        and group_matches.expires_at is null
        and group_matches.formation_version = ${GROUP_FORMATION_VERSION}
        and group_matches.rule_version = ${GROUP_RULE_VERSION}
        and group_matches.scoring_version = ${GROUP_SCORING_VERSION}
      returning
        id,
        total_rounds,
        player_limit,
        created_at,
        expires_at,
        formation_version,
        rule_version,
        scoring_version,
        (xmax = 0) as created
    ), placement_input as materialized (
      select *
      from jsonb_to_recordset(${JSON.stringify(placementRows)}::jsonb) as value(
        round_number smallint,
        bag_count smallint,
        bomb_bag_number smallint,
        coin_bag_numbers smallint[],
        source text
      )
    ), inserted_placements as (
      insert into group_round_placements (
        group_id,
        round_number,
        bag_count,
        bomb_bag_number,
        coin_bag_numbers,
        source
      )
      select
        match_row.id,
        placement_input.round_number,
        placement_input.bag_count,
        placement_input.bomb_bag_number,
        placement_input.coin_bag_numbers,
        placement_input.source
      from match_row
      inner join placement_input on match_row.created
      on conflict (group_id, round_number) do nothing
      returning group_id, round_number
    ), placement_integrity as materialized (
      select
        match_row.id as group_id,
        count(inserted_placement.*)::integer as placement_count,
        count(distinct inserted_placement.round_number)::integer as distinct_round_count,
        min(inserted_placement.round_number)::integer as first_round,
        max(inserted_placement.round_number)::integer as last_round
      from match_row
      left join inserted_placements inserted_placement
        on inserted_placement.group_id = match_row.id
      group by match_row.id
    )
    select
      match_row.id as group_id,
      match_row.total_rounds,
      match_row.player_limit,
      match_row.created_at,
      match_row.expires_at,
      match_row.formation_version,
      match_row.rule_version,
      match_row.scoring_version,
      match_row.created,
      match_row.total_rounds / case
        when not match_row.created
          or (
            placement_integrity.placement_count = match_row.total_rounds
            and placement_integrity.distinct_round_count = match_row.total_rounds
            and placement_integrity.first_round = 1
            and placement_integrity.last_round = match_row.total_rounds
          )
        then 1
        else 0
      end as atomic_guard
    from match_row
    inner join placement_integrity
      on placement_integrity.group_id = match_row.id
  `)

  const row = result.rows[0]
  if (!row) return null
  if (
    row.expires_at !== null ||
    row.formation_version !== GROUP_FORMATION_VERSION ||
    row.rule_version !== GROUP_RULE_VERSION ||
    row.scoring_version !== GROUP_SCORING_VERSION
  ) {
    throw new Error('Persisted GROUP has an unsupported version state.')
  }
  if (row.atomic_guard !== row.total_rounds) {
    throw new Error('Persisted GROUP failed its atomic placement guard.')
  }
  return {
    groupId: row.group_id,
    totalRounds: row.total_rounds,
    playerLimit: row.player_limit,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: null,
    formationVersion: GROUP_FORMATION_VERSION,
    ruleVersion: GROUP_RULE_VERSION,
    scoringVersion: GROUP_SCORING_VERSION,
    created: row.created,
  }
}
