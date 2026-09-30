import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelOpponentPlacementRole = 'A' | 'B'

export interface DuelOpponentPlacementView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface PersistedDuelOpponentPlacements {
  readonly matchId: string
  readonly role: DuelOpponentPlacementRole
  readonly totalRounds: number
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly placements: readonly DuelOpponentPlacementView[]
}

export interface GetDuelOpponentPlacementsInput {
  readonly matchId: string
  readonly participantTokenHash: string
}

export interface DuelOpponentPlacementRecord extends Record<string, unknown> {
  readonly match_id: string
  readonly role: DuelOpponentPlacementRole
  readonly total_rounds: number
  readonly formation_version: number
  readonly rule_version: number
  readonly round_number: number | null
  readonly bag_count: number | null
  readonly bomb_bag_number: number | null
  readonly coin_bag_numbers: unknown
}

function placementFromRow(
  row: DuelOpponentPlacementRecord,
  expectedRoundNumber: number,
): DuelOpponentPlacementView {
  const coins = row.coin_bag_numbers
  if (
    row.round_number !== expectedRoundNumber ||
    !Number.isInteger(row.bag_count) ||
    (row.bag_count as number) < 3 ||
    (row.bag_count as number) > 8 ||
    !Number.isInteger(row.bomb_bag_number) ||
    (row.bomb_bag_number as number) < 1 ||
    (row.bomb_bag_number as number) > (row.bag_count as number) ||
    !Array.isArray(coins) ||
    coins.length !== 3 ||
    coins.some(
      (bag) =>
        !Number.isInteger(bag) ||
        bag < 1 ||
        bag > (row.bag_count as number),
    ) ||
    coins.some((bag) => bag === row.bomb_bag_number) ||
    coins.some((bag, index) => index > 0 && bag < coins[index - 1])
  ) {
    throw new Error('DUEL opponent placements are inconsistent.')
  }
  return {
    roundNumber: row.round_number,
    bagCount: row.bag_count as number,
    bombBagNumber: row.bomb_bag_number as number,
    coinBagNumbers: [coins[0], coins[1], coins[2]] as [number, number, number],
  }
}

export function toPersistedDuelOpponentPlacements(
  rows: readonly DuelOpponentPlacementRecord[],
): PersistedDuelOpponentPlacements | null {
  if (rows.length === 0) return null
  const first = rows[0]!
  if (
    (first.role !== 'A' && first.role !== 'B') ||
    !Number.isInteger(first.total_rounds) ||
    first.total_rounds < 1 ||
    first.total_rounds > 20 ||
    !Number.isInteger(first.formation_version) ||
    first.formation_version < 1 ||
    !Number.isInteger(first.rule_version) ||
    first.rule_version < 1 ||
    rows.length !== first.total_rounds ||
    rows.some(
      (row) =>
        row.match_id !== first.match_id ||
        row.role !== first.role ||
        row.total_rounds !== first.total_rounds ||
        row.formation_version !== first.formation_version ||
        row.rule_version !== first.rule_version,
    )
  ) {
    throw new Error('DUEL opponent placements are inconsistent.')
  }
  const placements = rows.map((row, index) => placementFromRow(row, index + 1))
  return {
    matchId: first.match_id,
    role: first.role,
    totalRounds: first.total_rounds,
    formationVersion: first.formation_version,
    ruleVersion: first.rule_version,
    placements,
  }
}

/** Returns every opponent placement only after both participants are READY. */
export async function getDuelOpponentPlacementsForParticipant(
  input: GetDuelOpponentPlacementsInput,
): Promise<PersistedDuelOpponentPlacements | null> {
  const result = await getDatabase().execute<DuelOpponentPlacementRecord>(sql`
    select
      match.id as match_id,
      self.role,
      match.total_rounds,
      match.formation_version,
      match.rule_version,
      placement.round_number,
      placement.bag_count,
      placement.bomb_bag_number,
      placement.coin_bag_numbers
    from duel_matches match
    inner join duel_participants self
      on self.match_id = match.id
      and self.auth_token_hash = ${input.participantTokenHash}
    inner join duel_participants opponent
      on opponent.match_id = match.id
      and opponent.role <> self.role
    left join duel_round_placements placement
      on placement.match_id = match.id
      and placement.participant_role = opponent.role
    where match.id = ${input.matchId}::uuid
      and self.claimed_at is not null
      and self.placement_locked_at is not null
      and opponent.claimed_at is not null
      and opponent.placement_locked_at is not null
      and (
        match.expires_at is null
        or match.expires_at > statement_timestamp()
      )
    order by placement.round_number nulls last
  `)
  return toPersistedDuelOpponentPlacements(result.rows)
}
