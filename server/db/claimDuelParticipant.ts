import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export interface ClaimDuelParticipantInput {
  readonly matchId: string
  readonly invitationTokenHash: string
  readonly participantTokenHash: string
}

export interface ClaimedDuelParticipant {
  readonly matchId: string
  readonly totalRounds: number
  readonly createdAt: string
  readonly claimedAt: string
  readonly expiresAt: string | null
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly claimed: boolean
}

interface ClaimedDuelParticipantRow extends Record<string, unknown> {
  readonly match_id: string
  readonly total_rounds: number
  readonly created_at: Date | string
  readonly claimed_at: Date | string
  readonly expires_at: Date | string | null
  readonly formation_version: number
  readonly rule_version: number
  readonly claimed: boolean
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Claims participant B or recognizes an exact retry in one atomic statement.
 * A retry must reproduce the auth hash derived from both the original invite
 * token and the original claim recovery secret.
 */
export async function claimDuelParticipant(
  input: ClaimDuelParticipantInput,
): Promise<ClaimedDuelParticipant | null> {
  const result = await getDatabase().execute<ClaimedDuelParticipantRow>(sql`
    with candidate as materialized (
      select
        participant.match_id,
        participant.role,
        participant.auth_token_hash as previous_auth_token_hash,
        participant.claimed_at as previous_claimed_at,
        participant.version as previous_version,
        match.total_rounds,
        match.created_at,
        match.expires_at,
        match.formation_version,
        match.rule_version
      from duel_participants participant
      inner join duel_matches match on match.id = participant.match_id
      inner join duel_participants creator
        on creator.match_id = participant.match_id
        and creator.role = 'A'
        and creator.placement_locked_at is not null
      where participant.match_id = ${input.matchId}::uuid
        and participant.role = 'B'
        and (
          match.expires_at is null
          or match.expires_at > statement_timestamp()
        )
        and (
          (
            participant.auth_token_hash is null
            and participant.invite_token_hash = ${input.invitationTokenHash}
            and participant.claimed_at is null
          )
          or (
            participant.auth_token_hash = ${input.participantTokenHash}
            and participant.invite_token_hash is null
            and participant.claimed_at is not null
          )
        )
      for update of participant
    ), updated as (
      update duel_participants participant
      set
        auth_token_hash = case
          when candidate.previous_auth_token_hash is null
            then ${input.participantTokenHash}
          else participant.auth_token_hash
        end,
        invite_token_hash = null,
        claimed_at = case
          when candidate.previous_claimed_at is null
            then statement_timestamp()
          else participant.claimed_at
        end,
        version = case
          when candidate.previous_auth_token_hash is null
            then participant.version + 1
          else participant.version
        end
      from candidate
      where participant.match_id = candidate.match_id
        and participant.role = candidate.role
      returning
        participant.match_id,
        participant.claimed_at,
        candidate.total_rounds,
        candidate.created_at,
        candidate.expires_at,
        candidate.formation_version,
        candidate.rule_version,
        (candidate.previous_auth_token_hash is null) as claimed
    )
    select * from updated
  `)

  const row = result.rows[0]
  if (!row) return null

  return {
    matchId: row.match_id,
    totalRounds: row.total_rounds,
    createdAt: isoTimestamp(row.created_at),
    claimedAt: isoTimestamp(row.claimed_at),
    expiresAt: row.expires_at === null ? null : isoTimestamp(row.expires_at),
    formationVersion: row.formation_version,
    ruleVersion: row.rule_version,
    claimed: row.claimed,
  }
}
