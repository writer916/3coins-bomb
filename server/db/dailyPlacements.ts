import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import {
  DAILY_CHALLENGE_ROUNDS,
  DAILY_FORMATION_VERSION,
  DAILY_RULE_VERSION,
  validateDailyQuestionRound,
  type DailyQuestionRound,
} from '../../src/daily/dailyQuestionSet.js'
import { getDatabase } from './client.js'

export interface PersistedDailyPlacementSet {
  readonly challengeDate: DailyChallengeDate
  readonly formationVersion: typeof DAILY_FORMATION_VERSION
  readonly ruleVersion: typeof DAILY_RULE_VERSION
  /** Play-order placements (roundNumber 1..20) for this participant only. */
  readonly placements: readonly DailyQuestionRound[]
}

interface PlacementRow extends Record<string, unknown> {
  readonly challenge_date: string | Date
  readonly formation_version: number
  readonly rule_version: number
  readonly round_number: number
  readonly bag_count: number
  readonly bomb_bag_number: number
  readonly coin_bag_numbers: number[]
  readonly placement_count: number
}

function asChallengeDate(value: string | Date): DailyChallengeDate {
  if (typeof value === 'string') {
    return value.slice(0, 10) as DailyChallengeDate
  }
  return value.toISOString().slice(0, 10) as DailyChallengeDate
}

/**
 * Returns the day's 20 placements remapped into this participant's play order.
 * Requires a joined participant (auth token hash × challenge date). Does not
 * expose question_order, other participants, or raw challenge-round numbering.
 */
export async function getDailyPlacementsForParticipant(input: {
  readonly challengeDate: DailyChallengeDate
  readonly authTokenHash: string
}): Promise<PersistedDailyPlacementSet | null> {
  const result = await getDatabase().execute<PlacementRow>(sql`
    with participant as materialized (
      select
        joined.challenge_date,
        joined.question_order,
        challenge.formation_version,
        challenge.rule_version
      from daily_challenge_participants joined
      inner join daily_challenges challenge
        on challenge.challenge_date = joined.challenge_date
      where joined.challenge_date = ${input.challengeDate}::date
        and joined.auth_token_hash = ${input.authTokenHash}
      limit 1
    ),
    ordered as (
      select
        participant.challenge_date,
        participant.formation_version,
        participant.rule_version,
        play_slot.ordinality::integer as round_number,
        placement.bag_count,
        placement.bomb_bag_number,
        placement.coin_bag_numbers
      from participant
      cross join lateral unnest(participant.question_order)
        with ordinality as play_slot(challenge_round_number, ordinality)
      inner join daily_challenge_placements placement
        on placement.challenge_date = participant.challenge_date
        and placement.round_number = play_slot.challenge_round_number
    )
    select
      challenge_date,
      formation_version,
      rule_version,
      round_number,
      bag_count,
      bomb_bag_number,
      coin_bag_numbers,
      count(*) over ()::integer as placement_count
    from ordered
    order by round_number
  `)

  if (result.rows.length === 0) return null

  const first = result.rows[0]!
  if (
    Number(first.formation_version) !== DAILY_FORMATION_VERSION ||
    Number(first.rule_version) !== DAILY_RULE_VERSION
  ) {
    throw new Error('DAILY placements have an unsupported version state.')
  }
  if (
    Number(first.placement_count) !== DAILY_CHALLENGE_ROUNDS ||
    result.rows.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    throw new Error('DAILY placements are inconsistent with the 20-round set.')
  }

  const challengeDate = asChallengeDate(first.challenge_date)
  const placements = result.rows.map((row, index) =>
    validateDailyQuestionRound(
      {
        roundNumber: Number(row.round_number),
        bagCount: Number(row.bag_count),
        bombBagNumber: Number(row.bomb_bag_number),
        coinBagNumbers: row.coin_bag_numbers,
      },
      index + 1,
    ),
  )

  return {
    challengeDate,
    formationVersion: DAILY_FORMATION_VERSION,
    ruleVersion: DAILY_RULE_VERSION,
    placements,
  }
}
