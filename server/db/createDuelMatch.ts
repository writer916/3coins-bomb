import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export interface PersistDuelMatchInput {
  readonly createRequestId: string
  readonly totalRounds: number
  readonly participantTokenHash: string
  readonly invitationTokenHash: string
}

export interface PersistedDuelMatch {
  readonly matchId: string
  readonly totalRounds: number
  readonly createdAt: string
  readonly expiresAt: null
  readonly formationVersion: 1
  readonly ruleVersion: 1
  readonly created: boolean
}

interface PersistedDuelMatchRow extends Record<string, unknown> {
  readonly match_id: string
  readonly total_rounds: number
  readonly created_at: Date | string
  readonly expires_at: null
  readonly formation_version: number
  readonly rule_version: number
  readonly created: boolean
}

/**
 * Atomically creates a match and its A/B participant rows. An existing request
 * returns a row only when every immutable input and participant hash matches.
 */
export async function persistDuelMatch(
  input: PersistDuelMatchInput,
): Promise<PersistedDuelMatch | null> {
  const result = await getDatabase().execute<PersistedDuelMatchRow>(sql`
    with match_row as (
      insert into duel_matches (
        total_rounds,
        create_request_id,
        expires_at,
        formation_version,
        rule_version
      ) values (
        ${input.totalRounds},
        ${input.createRequestId}::uuid,
        null,
        1,
        1
      )
      on conflict (create_request_id) do update
      set create_request_id = excluded.create_request_id
      where duel_matches.total_rounds = excluded.total_rounds
        and duel_matches.expires_at is null
        and duel_matches.formation_version = 1
        and duel_matches.rule_version = 1
      returning
        id,
        total_rounds,
        created_at,
        expires_at,
        formation_version,
        rule_version,
        (xmax = 0) as created
    ), participant_a as (
      insert into duel_participants (
        match_id,
        role,
        auth_token_hash,
        invite_token_hash,
        claimed_at,
        placement_locked_at,
        version
      )
      select
        id,
        'A',
        ${input.participantTokenHash},
        null,
        statement_timestamp(),
        null,
        0
      from match_row
      on conflict (match_id, role) do update
      set auth_token_hash = duel_participants.auth_token_hash
      where duel_participants.role = 'A'
        and duel_participants.auth_token_hash = excluded.auth_token_hash
        and duel_participants.invite_token_hash is null
        and duel_participants.claimed_at is not null
      returning match_id
    ), participant_b as (
      insert into duel_participants (
        match_id,
        role,
        auth_token_hash,
        invite_token_hash,
        claimed_at,
        placement_locked_at,
        version
      )
      select
        id,
        'B',
        null,
        ${input.invitationTokenHash},
        null,
        null,
        0
      from match_row
      on conflict (match_id, role) do update
      set invite_token_hash = duel_participants.invite_token_hash
      where duel_participants.role = 'B'
        and duel_participants.auth_token_hash is null
        and duel_participants.invite_token_hash = excluded.invite_token_hash
        and duel_participants.claimed_at is null
      returning match_id
    )
    select
      match_row.id as match_id,
      match_row.total_rounds,
      match_row.created_at,
      match_row.expires_at,
      match_row.formation_version,
      match_row.rule_version,
      match_row.created
    from match_row
    inner join participant_a on participant_a.match_id = match_row.id
    inner join participant_b on participant_b.match_id = match_row.id
  `)

  const row = result.rows[0]
  if (!row) return null

  if (
    row.expires_at !== null ||
    row.formation_version !== 1 ||
    row.rule_version !== 1
  ) {
    throw new Error('Persisted DUEL match has an unsupported version state.')
  }

  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString()

  return {
    matchId: row.match_id,
    totalRounds: row.total_rounds,
    createdAt,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    created: row.created,
  }
}
