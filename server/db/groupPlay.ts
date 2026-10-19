import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export type GroupStatus = 'open' | 'closed'

export interface GroupActiveAttemptView {
  readonly roundNumber: number
  readonly startedAt: string
  readonly openedBagCount: number
  readonly openedBags: readonly GroupOpenedBagView[]
  readonly provisionalCoins: number
}

export interface GroupOpenedBagView {
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: 'empty' | 'coins' | 'bomb'
  readonly coinsFound: number
}

export interface GroupTerminalAttemptView {
  readonly roundNumber: number
  readonly endReason: 'bombed' | 'cashed_out' | 'cleared' | 'interrupted'
  readonly capturedCoins: number
  readonly openedBagCount: number
  readonly openedBags: readonly GroupOpenedBagView[]
}

export interface PersistedGroupPlayState {
  readonly groupId: string
  readonly totalRounds: number
  readonly groupStatus: GroupStatus
  readonly participant: {
    readonly id: string
    readonly displayNickname: string
    readonly completed: boolean
    readonly excluded: boolean
  }
  readonly completedRounds: number
  readonly nextRoundNumber: number | null
  readonly activeAttempt: GroupActiveAttemptView | null
  readonly latestTerminalAttempt: GroupTerminalAttemptView | null
}

export interface GroupPlacementView {
  readonly roundNumber: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
}

export interface PersistedGroupPlacementSet {
  readonly groupId: string
  readonly totalRounds: number
  readonly formationVersion: number
  readonly ruleVersion: number
  readonly placements: readonly GroupPlacementView[]
}

interface StateRow extends Record<string, unknown> {
  readonly group_id: string
  readonly total_rounds: number
  readonly group_status: GroupStatus
  readonly participant_id: string
  readonly display_nickname: string
  readonly completed_at: Date | string | null
  readonly excluded_at: Date | string | null
  readonly terminal_count: number
  readonly terminal_first: number | null
  readonly terminal_last: number | null
  readonly active_count: number
  readonly active_round: number | null
  readonly active_attempt: unknown | null
  readonly latest_terminal_attempt: unknown | null
}

interface PlacementRow extends Record<string, unknown> {
  readonly group_id: string
  readonly total_rounds: number
  readonly formation_version: number
  readonly rule_version: number
  readonly round_number: number
  readonly bag_count: number
  readonly bomb_bag_number: number
  readonly coin_bag_numbers: number[]
}
interface MutationRow extends Record<string, unknown> { readonly accepted: boolean }

function toState(row: StateRow): PersistedGroupPlayState {
  const contiguous =
    row.terminal_count === 0 ||
    (row.terminal_first === 1 && row.terminal_last === row.terminal_count)
  if (
    !contiguous ||
    row.terminal_count < 0 ||
    row.terminal_count > row.total_rounds ||
    row.active_count < 0 ||
    row.active_count > 1 ||
    (row.active_count === 1 && row.active_round !== row.terminal_count + 1)
  ) {
    throw new Error('GROUP play state is inconsistent.')
  }
  const completed = row.completed_at !== null || row.terminal_count === row.total_rounds
  const excluded = row.excluded_at !== null
  const activeAttempt = row.active_count === 1
    ? parseActiveAttempt(row.active_attempt)
    : null
  const latestTerminalAttempt = parseTerminalAttempt(row.latest_terminal_attempt)
  return {
    groupId: row.group_id,
    totalRounds: row.total_rounds,
    groupStatus: row.group_status,
    participant: {
      id: row.participant_id,
      displayNickname: row.display_nickname,
      completed,
      excluded,
    },
    completedRounds: row.terminal_count,
    nextRoundNumber:
      completed || excluded || row.group_status === 'closed'
        ? null
        : activeAttempt?.roundNumber ?? row.terminal_count + 1,
    activeAttempt,
    latestTerminalAttempt,
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GROUP play state is inconsistent.')
  }
  return value as Record<string, unknown>
}

function parseOpenedBags(value: unknown): readonly GroupOpenedBagView[] {
  if (!Array.isArray(value)) throw new Error('GROUP play state is inconsistent.')
  return value.map((item, index) => {
    const opened = object(item)
    if (
      typeof opened.bagNumber !== 'number' ||
      typeof opened.openOrder !== 'number' ||
      opened.openOrder !== index + 1 ||
      (opened.outcome !== 'empty' && opened.outcome !== 'coins' && opened.outcome !== 'bomb') ||
      typeof opened.coinsFound !== 'number'
    ) throw new Error('GROUP play state is inconsistent.')
    return {
      bagNumber: opened.bagNumber,
      openOrder: opened.openOrder,
      outcome: opened.outcome,
      coinsFound: opened.coinsFound,
    }
  })
}

function parseActiveAttempt(value: unknown): GroupActiveAttemptView {
  const attempt = object(value)
  const openedBags = parseOpenedBags(attempt.openedBags)
  if (
    typeof attempt.roundNumber !== 'number' ||
    typeof attempt.startedAt !== 'string' ||
    typeof attempt.openedBagCount !== 'number' ||
    attempt.openedBagCount !== openedBags.length ||
    typeof attempt.provisionalCoins !== 'number'
  ) throw new Error('GROUP play state is inconsistent.')
  return {
    roundNumber: attempt.roundNumber,
    startedAt: new Date(attempt.startedAt).toISOString(),
    openedBagCount: attempt.openedBagCount,
    openedBags,
    provisionalCoins: attempt.provisionalCoins,
  }
}

function parseTerminalAttempt(value: unknown | null): GroupTerminalAttemptView | null {
  if (value === null) return null
  const attempt = object(value)
  const openedBags = parseOpenedBags(attempt.openedBags)
  if (
    typeof attempt.roundNumber !== 'number' ||
    (attempt.endReason !== 'bombed' && attempt.endReason !== 'cashed_out' &&
      attempt.endReason !== 'cleared' && attempt.endReason !== 'interrupted') ||
    typeof attempt.capturedCoins !== 'number' ||
    typeof attempt.openedBagCount !== 'number' ||
    attempt.openedBagCount !== openedBags.length
  ) throw new Error('GROUP play state is inconsistent.')
  return {
    roundNumber: attempt.roundNumber,
    endReason: attempt.endReason,
    capturedCoins: attempt.capturedCoins,
    openedBagCount: attempt.openedBagCount,
    openedBags,
  }
}

const STATE_SELECT = sql`
  select
    match.id as group_id,
    match.total_rounds,
    match.status as group_status,
    participant.id as participant_id,
    participant.display_nickname,
    participant.completed_at,
    participant.excluded_at,
    count(attempt.*) filter (where attempt.status <> 'active')::integer as terminal_count,
    min(attempt.round_number) filter (where attempt.status <> 'active')::integer as terminal_first,
    max(attempt.round_number) filter (where attempt.status <> 'active')::integer as terminal_last,
    count(attempt.*) filter (where attempt.status = 'active')::integer as active_count,
    min(attempt.round_number) filter (where attempt.status = 'active')::integer as active_round,
    (
      select json_build_object(
        'roundNumber', active.round_number,
        'startedAt', active.started_at,
        'openedBagCount', active.opened_bag_count,
        'provisionalCoins', coalesce((
          select count(coin_bag)::integer
          from group_round_opens opened
          left join lateral unnest(placement.coin_bag_numbers) coin_bag
            on coin_bag = opened.bag_number
          where opened.group_id = active.group_id
            and opened.participant_id = active.participant_id
            and opened.round_number = active.round_number
        ), 0),
        'openedBags', coalesce((
          select json_agg(json_build_object(
            'bagNumber', opened.bag_number,
            'openOrder', opened.open_order,
            'outcome', case when opened.bag_number = placement.bomb_bag_number then 'bomb'
              when (select count(*) from unnest(placement.coin_bag_numbers) coin where coin = opened.bag_number) > 0 then 'coins'
              else 'empty' end,
            'coinsFound', (select count(*) from unnest(placement.coin_bag_numbers) coin where coin = opened.bag_number)
          ) order by opened.open_order)
          from group_round_opens opened
          where opened.group_id = active.group_id
            and opened.participant_id = active.participant_id
            and opened.round_number = active.round_number
        ), '[]'::json)
      )
      from group_round_attempts active
      inner join group_round_placements placement
        on placement.group_id = active.group_id and placement.round_number = active.round_number
      where active.group_id = participant.group_id and active.participant_id = participant.id
        and active.status = 'active'
      limit 1
    ) as active_attempt,
    (
      select json_build_object(
        'roundNumber', terminal.round_number,
        'endReason', terminal.status,
        'capturedCoins', terminal.captured_coins,
        'openedBagCount', terminal.opened_bag_count,
        'openedBags', coalesce((
          select json_agg(json_build_object(
            'bagNumber', opened.bag_number,
            'openOrder', opened.open_order,
            'outcome', case when opened.bag_number = placement.bomb_bag_number then 'bomb'
              when (select count(*) from unnest(placement.coin_bag_numbers) coin where coin = opened.bag_number) > 0 then 'coins'
              else 'empty' end,
            'coinsFound', (select count(*) from unnest(placement.coin_bag_numbers) coin where coin = opened.bag_number)
          ) order by opened.open_order)
          from group_round_opens opened
          where opened.group_id = terminal.group_id
            and opened.participant_id = terminal.participant_id
            and opened.round_number = terminal.round_number
        ), '[]'::json)
      )
      from group_round_attempts terminal
      inner join group_round_placements placement
        on placement.group_id = terminal.group_id and placement.round_number = terminal.round_number
      where terminal.group_id = participant.group_id and terminal.participant_id = participant.id
        and terminal.status <> 'active'
      order by terminal.round_number desc
      limit 1
    ) as latest_terminal_attempt
  from group_matches match
  inner join group_participants participant on participant.group_id = match.id
  left join group_round_attempts attempt
    on attempt.group_id = match.id and attempt.participant_id = participant.id
`

export async function getGroupPlayState(
  groupId: string,
  participantTokenHash: string,
): Promise<PersistedGroupPlayState | null> {
  const result = await getDatabase().execute<StateRow>(sql`
    ${STATE_SELECT}
    where match.id = ${groupId}::uuid
      and participant.auth_token_hash = ${participantTokenHash}
    group by match.id, participant.id
  `)
  return result.rows[0] ? toState(result.rows[0]) : null
}

export async function getGroupPlacements(
  groupId: string,
  participantTokenHash: string,
): Promise<PersistedGroupPlacementSet | null> {
  const result = await getDatabase().execute<PlacementRow>(sql`
    select
      match.id as group_id,
      match.total_rounds,
      match.formation_version,
      match.rule_version,
      placement.round_number,
      placement.bag_count,
      placement.bomb_bag_number,
      placement.coin_bag_numbers
    from group_matches match
    inner join group_participants participant
      on participant.group_id = match.id
      and participant.auth_token_hash = ${participantTokenHash}
    inner join group_round_placements placement on placement.group_id = match.id
    where match.id = ${groupId}::uuid
      and participant.excluded_at is null
    order by placement.round_number
  `)
  if (result.rows.length === 0) return null
  const first = result.rows[0]!
  if (
    result.rows.length !== first.total_rounds ||
    result.rows.some((row, index) => row.round_number !== index + 1)
  ) throw new Error('GROUP placements are inconsistent.')
  return {
    groupId: first.group_id,
    totalRounds: first.total_rounds,
    formationVersion: first.formation_version,
    ruleVersion: first.rule_version,
    placements: result.rows.map((row) => ({
      roundNumber: row.round_number,
      bagCount: row.bag_count,
      bombBagNumber: row.bomb_bag_number,
      coinBagNumbers: row.coin_bag_numbers as [number, number, number],
    })),
  }
}

export async function startGroupRound(input: {
  readonly groupId: string
  readonly participantTokenHash: string
  readonly requestId: string
}): Promise<PersistedGroupPlayState | null> {
  const result = await getDatabase().execute<MutationRow>(sql`
    with locked_participant as materialized (
      select participant.id, participant.group_id, participant.completed_at,
        match.total_rounds, match.status group_status
      from group_participants participant
      inner join group_matches match on match.id = participant.group_id
      where participant.group_id = ${input.groupId}::uuid
        and participant.auth_token_hash = ${input.participantTokenHash}
      for update of match, participant
    ), progress as materialized (
      select
        locked.id as participant_id,
        locked.group_id,
        count(attempt.*) filter (where attempt.status <> 'active')::integer as terminal_count,
        count(attempt.*) filter (where attempt.status = 'active')::integer as active_count
      from locked_participant locked
      left join group_round_attempts attempt
        on attempt.group_id = locked.group_id and attempt.participant_id = locked.id
      group by locked.id, locked.group_id
    ), inserted as (
      insert into group_round_attempts (
        participant_id, group_id, round_number, status, captured_coins,
        opened_bag_count, start_request_id, terminal_request_id, version
      )
      select
        progress.participant_id,
        progress.group_id,
        progress.terminal_count + 1,
        'active', 0, 0, ${input.requestId}::uuid, null, 0
      from progress
      inner join group_matches match on match.id = progress.group_id
      inner join group_participants participant on participant.id = progress.participant_id
      where progress.active_count = 0
        and progress.terminal_count < match.total_rounds
        and match.status = 'open'
        and participant.completed_at is null
        and participant.excluded_at is null
      on conflict (start_request_id) do nothing
      returning participant_id
    )
    select (
      exists(select 1 from inserted)
      or exists(
        select 1
        from group_round_attempts retry
        inner join locked_participant participant on participant.id = retry.participant_id
        where retry.start_request_id = ${input.requestId}::uuid
          and retry.status = 'active'
      )
    ) as accepted
  `)
  if (!result.rows[0]?.accepted) return null
  return getGroupPlayState(input.groupId, input.participantTokenHash)
}

export async function resumeGroupPlay(input: {
  readonly groupId: string
  readonly participantTokenHash: string
  readonly requestId: string
}): Promise<PersistedGroupPlayState | null> {
  void input.requestId
  return getGroupPlayState(input.groupId, input.participantTokenHash)
}
