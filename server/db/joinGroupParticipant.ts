import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'

export interface JoinGroupParticipantInput {
  readonly groupId: string
  readonly invitationTokenHash: string
  readonly hostTokenHash: string | null
  readonly displayNickname: string
  readonly nicknameKey: string
  readonly authTokenHash: string
}

export interface JoinedGroupParticipant {
  readonly groupId: string
  readonly participantId: string
  readonly displayNickname: string
  readonly acceptedAt: string
  readonly completedAt: string | null
  readonly excludedAt: string | null
  readonly participantVersion: number
  readonly totalRounds: number
  readonly playerLimit: number
  readonly groupStatus: 'open' | 'closed'
  readonly joined: boolean
  readonly isHost: boolean
}

interface Row extends Record<string, unknown> {
  readonly group_id: string
  readonly participant_id: string
  readonly display_nickname: string
  readonly accepted_at: Date | string
  readonly completed_at: Date | string | null
  readonly excluded_at: Date | string | null
  readonly participant_version: number
  readonly total_rounds: number
  readonly player_limit: number
  readonly group_status: 'open' | 'closed'
  readonly joined: boolean
  readonly is_host: boolean
  readonly atomic_guard: number
}

function optionalIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

/**
 * Upserts one logical nickname identity and atomically reserves capacity only
 * for a newly inserted participant. A failed reservation aborts the statement,
 * so no over-capacity participant can remain.
 */
export async function joinGroupParticipant(
  input: JoinGroupParticipantInput,
): Promise<JoinedGroupParticipant | null> {
  const result = await getDatabase().execute<Row>(sql`
    with match_row as materialized (
      select
        id,
        total_rounds,
        player_limit,
        status
      from group_matches
      where id = ${input.groupId}::uuid
        and invite_token_hash = ${input.invitationTokenHash}
      for update
    ), participant_row as materialized (
      insert into group_participants (
        group_id,
        display_nickname,
        nickname_key,
        auth_token_hash,
        completed_at,
        excluded_at,
        version
      )
      select
        match_row.id,
        ${input.displayNickname},
        ${input.nicknameKey},
        ${input.authTokenHash},
        null,
        null,
        0
      from match_row
      on conflict (group_id, nickname_key) do update
      set nickname_key = excluded.nickname_key
      returning
        id,
        group_id,
        display_nickname,
        accepted_at,
        completed_at,
        excluded_at,
        version,
        (xmax = 0) as joined
    ), updated_match as (
      update group_matches match
      set
        accepted_count = match.accepted_count + case
          when participant.joined then 1
          else 0
        end,
        host_participant_id = case
          when ${input.hostTokenHash}::text is not null
            and match.host_token_hash = ${input.hostTokenHash}
            and (
              match.host_participant_id is null
              or match.host_participant_id = participant.id
            )
          then participant.id
          else match.host_participant_id
        end,
        updated_at = statement_timestamp()
      from participant_row participant
      where match.id = participant.group_id
        and (
          not participant.joined
          or (
            match.status = 'open'
            and match.accepted_count < match.player_limit
          )
        )
      returning match.id, match.host_participant_id, match.host_token_hash
    )
    select
      participant.group_id,
      participant.id as participant_id,
      participant.display_nickname,
      participant.accepted_at,
      participant.completed_at,
      participant.excluded_at,
      participant.version as participant_version,
      match_row.total_rounds,
      match_row.player_limit,
      match_row.status as group_status,
      participant.joined,
      (${input.hostTokenHash}::text is not null and exists(
        select 1 from updated_match
        where updated_match.host_participant_id = participant.id
          and updated_match.host_token_hash = ${input.hostTokenHash}
      )) as is_host,
      1 / case
        when exists(select 1 from updated_match)
        then 1
        else 0
      end as atomic_guard
    from participant_row participant
    inner join match_row on match_row.id = participant.group_id
  `)
  const row = result.rows[0]
  if (!row) return null
  if (row.atomic_guard !== 1) throw new Error('GROUP join atomic guard failed.')
  return {
    groupId: row.group_id,
    participantId: row.participant_id,
    displayNickname: row.display_nickname,
    acceptedAt: new Date(row.accepted_at).toISOString(),
    completedAt: optionalIso(row.completed_at),
    excludedAt: optionalIso(row.excluded_at),
    participantVersion: row.participant_version,
    totalRounds: row.total_rounds,
    playerLimit: row.player_limit,
    groupStatus: row.group_status,
    joined: row.joined,
    isHost: row.is_host,
  }
}
