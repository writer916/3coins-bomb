import { sql } from 'drizzle-orm'
import type { DailyChallengeDate } from '../../src/daily/dailyChallengeDate.js'
import {
  DAILY_CHALLENGE_ROUNDS,
  DAILY_FORMATION_VERSION,
  DAILY_RULE_VERSION,
  validateDailyQuestionSet,
  type DailyQuestionRound,
  type DailyQuestionSet,
} from '../../src/daily/dailyQuestionSet.js'
import { getDatabase } from './client.js'

interface DailyQuestionSetRow extends Record<string, unknown> {
  readonly challenge_date: string
  readonly created_at: Date | string
  readonly created: boolean
  readonly formation_version: number
  readonly rule_version: number
  readonly placement_count: number
  readonly placements: unknown
}

/**
 * Atomically inserts a new UTC-day challenge + 20 placements, or returns the
 * already-persisted set when another writer won the unique date race.
 */
export async function persistOrLoadDailyQuestionSet(input: {
  readonly challengeDate: DailyChallengeDate
  readonly rounds: readonly DailyQuestionRound[]
}): Promise<DailyQuestionSet> {
  if (input.rounds.length !== DAILY_CHALLENGE_ROUNDS) {
    throw new Error('DAILY question set must contain exactly 20 rounds.')
  }
  const placementRows = input.rounds.map((round) => ({
    round_number: round.roundNumber,
    bag_count: round.bagCount,
    bomb_bag_number: round.bombBagNumber,
    coin_bag_numbers: round.coinBagNumbers,
  }))

  const result = await getDatabase().execute<DailyQuestionSetRow>(sql`
    with inserted_challenge as materialized (
      insert into daily_challenges (
        challenge_date,
        formation_version,
        rule_version
      ) values (
        ${input.challengeDate}::date,
        ${DAILY_FORMATION_VERSION},
        ${DAILY_RULE_VERSION}
      )
      on conflict (challenge_date) do nothing
      returning
        challenge_date,
        created_at,
        formation_version,
        rule_version,
        true as created
    ),
    existing_challenge as materialized (
      select
        challenge.challenge_date,
        challenge.created_at,
        challenge.formation_version,
        challenge.rule_version,
        false as created
      from daily_challenges challenge
      where challenge.challenge_date = ${input.challengeDate}::date
        and not exists (select 1 from inserted_challenge)
    ),
    challenge as materialized (
      select * from inserted_challenge
      union all
      select * from existing_challenge
    ),
    placement_input as materialized (
      select *
      from jsonb_to_recordset(${JSON.stringify(placementRows)}::jsonb) as value(
        round_number smallint,
        bag_count smallint,
        bomb_bag_number smallint,
        coin_bag_numbers smallint[]
      )
    ),
    inserted_placements as (
      insert into daily_challenge_placements (
        challenge_date,
        round_number,
        bag_count,
        bomb_bag_number,
        coin_bag_numbers
      )
      select
        challenge.challenge_date,
        placement_input.round_number,
        placement_input.bag_count,
        placement_input.bomb_bag_number,
        placement_input.coin_bag_numbers
      from challenge
      inner join placement_input on challenge.created
      on conflict (challenge_date, round_number) do nothing
      returning challenge_date, round_number
    ),
    placement_guard as materialized (
      select count(*)::integer as inserted_count from inserted_placements
    ),
    canonical as materialized (
      select
        placement.challenge_date,
        placement.round_number,
        placement.bag_count,
        placement.bomb_bag_number,
        placement.coin_bag_numbers
      from daily_challenge_placements placement
      inner join challenge on challenge.challenge_date = placement.challenge_date
    )
    select
      challenge.challenge_date,
      challenge.created_at,
      challenge.created,
      challenge.formation_version,
      challenge.rule_version,
      count(canonical.round_number)::integer as placement_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'roundNumber', canonical.round_number,
            'bagCount', canonical.bag_count,
            'bombBagNumber', canonical.bomb_bag_number,
            'coinBagNumbers', canonical.coin_bag_numbers
          )
          order by canonical.round_number
        ) filter (where canonical.round_number is not null),
        '[]'::jsonb
      ) as placements
    from challenge
    cross join placement_guard
    left join canonical on canonical.challenge_date = challenge.challenge_date
    where
      (not challenge.created and placement_guard.inserted_count = 0)
      or (
        challenge.created
        and placement_guard.inserted_count = ${DAILY_CHALLENGE_ROUNDS}
      )
    group by
      challenge.challenge_date,
      challenge.created_at,
      challenge.created,
      challenge.formation_version,
      challenge.rule_version
  `)

  const row = result.rows[0]
  if (!row) throw new Error('DAILY question set persistence returned no row.')
  if (
    row.formation_version !== DAILY_FORMATION_VERSION ||
    row.rule_version !== DAILY_RULE_VERSION
  ) {
    throw new Error('Persisted DAILY challenge has an unsupported version state.')
  }
  if (row.placement_count !== DAILY_CHALLENGE_ROUNDS) {
    throw new Error('Persisted DAILY challenge failed its placement integrity guard.')
  }

  const challengeDate =
    typeof row.challenge_date === 'string'
      ? row.challenge_date
      : new Date(row.challenge_date).toISOString().slice(0, 10)

  return validateDailyQuestionSet({
    challengeDate,
    createdAt: new Date(row.created_at).toISOString(),
    created: row.created,
    formationVersion: DAILY_FORMATION_VERSION,
    ruleVersion: DAILY_RULE_VERSION,
    rounds: row.placements,
  })
}

/** Read-only fetch for an already-persisted UTC day (null when absent). */
export async function loadDailyQuestionSet(
  challengeDate: DailyChallengeDate,
): Promise<DailyQuestionSet | null> {
  const result = await getDatabase().execute<DailyQuestionSetRow>(sql`
    select
      challenge.challenge_date,
      challenge.created_at,
      false as created,
      challenge.formation_version,
      challenge.rule_version,
      count(placement.round_number)::integer as placement_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'roundNumber', placement.round_number,
            'bagCount', placement.bag_count,
            'bombBagNumber', placement.bomb_bag_number,
            'coinBagNumbers', placement.coin_bag_numbers
          )
          order by placement.round_number
        ) filter (where placement.round_number is not null),
        '[]'::jsonb
      ) as placements
    from daily_challenges challenge
    left join daily_challenge_placements placement
      on placement.challenge_date = challenge.challenge_date
    where challenge.challenge_date = ${challengeDate}::date
    group by
      challenge.challenge_date,
      challenge.created_at,
      challenge.formation_version,
      challenge.rule_version
  `)
  const row = result.rows[0]
  if (!row) return null
  if (row.placement_count !== DAILY_CHALLENGE_ROUNDS) {
    throw new Error('Persisted DAILY challenge failed its placement integrity guard.')
  }
  const date =
    typeof row.challenge_date === 'string'
      ? row.challenge_date
      : new Date(row.challenge_date).toISOString().slice(0, 10)
  return validateDailyQuestionSet({
    challengeDate: date,
    createdAt: new Date(row.created_at).toISOString(),
    created: false,
    formationVersion: row.formation_version,
    ruleVersion: row.rule_version,
    rounds: row.placements,
  })
}
