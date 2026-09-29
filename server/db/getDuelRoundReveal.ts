import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type DuelRevealBagContents =
  | { readonly kind: 'empty' }
  | { readonly kind: 'coins'; readonly coinCount: 1 | 2 | 3 }
  | { readonly kind: 'bomb' }

export interface DuelRevealBagView {
  readonly bagNumber: number
  readonly contents: DuelRevealBagContents
}

export interface PersistedDuelRoundReveal {
  readonly matchId: string
  readonly roundNumber: number
  readonly bagCount: number
  readonly bags: readonly DuelRevealBagView[]
}

export interface GetDuelRoundRevealInput {
  readonly matchId: string
  readonly participantTokenHash: string
  readonly roundNumber: number
}

export interface DuelRoundRevealPlacementRecord extends Record<string, unknown> {
  readonly match_id: string
  readonly round_number: number
  readonly bag_count: number
  readonly bomb_bag_number: number
  readonly coin_bag_numbers: unknown
}

export function toPersistedDuelRoundReveal(
  row: DuelRoundRevealPlacementRecord,
): PersistedDuelRoundReveal {
  const { bag_count: bagCount, bomb_bag_number: bombBagNumber } = row
  const coinBagNumbers = row.coin_bag_numbers
  if (
    !Number.isInteger(row.round_number) ||
    !Number.isInteger(bagCount) ||
    bagCount < 3 ||
    bagCount > 8 ||
    !Number.isInteger(bombBagNumber) ||
    bombBagNumber < 1 ||
    bombBagNumber > bagCount ||
    !Array.isArray(coinBagNumbers) ||
    coinBagNumbers.length !== 3 ||
    coinBagNumbers.some(
      (bag) => !Number.isInteger(bag) || bag < 1 || bag > bagCount,
    ) ||
    coinBagNumbers.some((bag) => bag === bombBagNumber) ||
    coinBagNumbers.some((bag, index) => index > 0 && bag < coinBagNumbers[index - 1])
  ) {
    throw new Error('DUEL ROUND REVEAL placement is inconsistent.')
  }

  const coinCounts = new Map<number, number>()
  for (const bagNumber of coinBagNumbers as number[]) {
    coinCounts.set(bagNumber, (coinCounts.get(bagNumber) ?? 0) + 1)
  }

  const bags: DuelRevealBagView[] = []
  for (let bagNumber = 1; bagNumber <= bagCount; bagNumber += 1) {
    if (bagNumber === bombBagNumber) {
      bags.push({ bagNumber, contents: { kind: 'bomb' } })
      continue
    }
    const coinCount = coinCounts.get(bagNumber) ?? 0
    if (coinCount === 0) {
      bags.push({ bagNumber, contents: { kind: 'empty' } })
      continue
    }
    if (coinCount < 1 || coinCount > 3) {
      throw new Error('DUEL ROUND REVEAL placement is inconsistent.')
    }
    bags.push({
      bagNumber,
      contents: { kind: 'coins', coinCount: coinCount as 1 | 2 | 3 },
    })
  }

  return {
    matchId: row.match_id,
    roundNumber: row.round_number,
    bagCount,
    bags,
  }
}

/** Returns one opponent placement only after the authenticated explorer settled it. */
export async function getDuelRoundRevealForParticipant(
  input: GetDuelRoundRevealInput,
): Promise<PersistedDuelRoundReveal | null> {
  const result = await getDatabase().execute<DuelRoundRevealPlacementRecord>(sql`
    select
      match.id as match_id,
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
    inner join duel_round_results settled
      on settled.match_id = match.id
      and settled.explorer_role = self.role
      and settled.placement_role = opponent.role
      and settled.round_number = ${input.roundNumber}
    inner join duel_round_placements placement
      on placement.match_id = match.id
      and placement.participant_role = opponent.role
      and placement.round_number = settled.round_number
    where match.id = ${input.matchId}::uuid
      and ${input.roundNumber} between 1 and match.total_rounds
      and self.claimed_at is not null
      and self.placement_locked_at is not null
      and opponent.claimed_at is not null
      and opponent.placement_locked_at is not null
      and (
        match.expires_at is null
        or match.expires_at > statement_timestamp()
      )
  `)

  const row = result.rows[0]
  if (!row) return null
  if (result.rows.length !== 1) {
    throw new Error('DUEL ROUND REVEAL returned an inconsistent result.')
  }
  return toPersistedDuelRoundReveal(row)
}
