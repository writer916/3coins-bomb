import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelParticipantRole = 'A' | 'B'

export interface GetDuelMatchInput {
  readonly matchId: string
  readonly participantTokenHash: string
}

export interface DuelMatchParticipantState {
  readonly claimed: boolean
  readonly placementLocked: boolean
}

export interface PersistedDuelMatchView {
  readonly matchId: string
  readonly totalRounds: number
  readonly role: DuelParticipantRole
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly self: DuelMatchParticipantState
  readonly opponent: DuelMatchParticipantState
}

interface DuelMatchViewRow extends Record<string, unknown> {
  readonly match_id: string
  readonly total_rounds: number
  readonly role: DuelParticipantRole
  readonly created_at: Date | string
  readonly expires_at: Date | string | null
  readonly formation_version: number
  readonly rule_version: number
  readonly self_claimed: boolean
  readonly self_placement_locked: boolean
  readonly opponent_claimed: boolean
  readonly opponent_placement_locked: boolean
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** Returns the authenticated participant's minimal, non-secret match view. */
export async function getDuelMatchForParticipant(
  input: GetDuelMatchInput,
): Promise<PersistedDuelMatchView | null> {
  const result = await getDatabase().execute<DuelMatchViewRow>(sql`
    select
      match.id as match_id,
      match.total_rounds,
      self.role,
      match.created_at,
      match.expires_at,
      match.formation_version,
      match.rule_version,
      (self.claimed_at is not null) as self_claimed,
      (self.placement_locked_at is not null) as self_placement_locked,
      (opponent.claimed_at is not null) as opponent_claimed,
      (opponent.placement_locked_at is not null) as opponent_placement_locked
    from duel_matches match
    inner join duel_participants self
      on self.match_id = match.id
      and self.auth_token_hash = ${input.participantTokenHash}
    inner join duel_participants opponent
      on opponent.match_id = match.id
      and opponent.role <> self.role
    where match.id = ${input.matchId}::uuid
      and (
        match.expires_at is null
        or match.expires_at > statement_timestamp()
      )
  `)

  const row = result.rows[0]
  if (!row) return null

  return {
    matchId: row.match_id,
    totalRounds: row.total_rounds,
    role: row.role,
    createdAt: isoTimestamp(row.created_at),
    expiresAt: row.expires_at === null ? null : isoTimestamp(row.expires_at),
    formationVersion: row.formation_version,
    ruleVersion: row.rule_version,
    self: {
      claimed: row.self_claimed,
      placementLocked: row.self_placement_locked,
    },
    opponent: {
      claimed: row.opponent_claimed,
      placementLocked: row.opponent_placement_locked,
    },
  }
}
