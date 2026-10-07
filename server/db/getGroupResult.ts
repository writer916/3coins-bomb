import { sql } from 'drizzle-orm'
import {
  aggregateGroupParticipantResult,
  rankGroupParticipants,
  type GroupParticipantResultInput,
} from '../../src/group/groupDomain.js'
import { getDatabase } from './client.js'

export interface GroupResultEntry {
  readonly rank: number
  readonly nickname: string
  readonly isSelf: boolean
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly coinBagHitRate: { readonly numerator: number; readonly denominator: number }
}

export interface GroupResultView {
  readonly groupId: string
  readonly totalRounds: number
  readonly playerLimit: number
  readonly acceptedCount: number
  readonly completedCount: number
  readonly status: 'closed'
  readonly ranking: readonly GroupResultEntry[]
}

export type GroupResultSnapshot =
  | { readonly kind: 'open' }
  | { readonly kind: 'closed'; readonly view: GroupResultView }

interface ResultRow extends Record<string, unknown> {
  group_id: string
  total_rounds: number
  player_limit: number
  accepted_count: number
  status: 'open' | 'closed'
  completed_count: number
  placements: unknown
  participants: unknown
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GROUP result data.')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid GROUP result data.')
  return value
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Invalid GROUP result data.')
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid GROUP result data.')
  return value
}
function timestamp(value: unknown): string {
  const parsed = new Date(text(value))
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid GROUP result data.')
  return parsed.toISOString()
}

function participantInput(value: unknown, placements: GroupParticipantResultInput['placements'], totalRounds: number): GroupParticipantResultInput & { nickname: string; isSelf: boolean } {
  const participant = object(value)
  if (typeof participant.isSelf !== 'boolean') throw new Error('Invalid GROUP result data.')
  return {
    participantId: text(participant.participantId),
    nickname: text(participant.nickname),
    isSelf: participant.isSelf,
    acceptedAt: timestamp(participant.acceptedAt),
    totalRounds,
    placements,
    rounds: array(participant.rounds).map((roundValue) => {
      const round = object(roundValue)
      const endReason = text(round.endReason)
      if (!['bombed', 'cashed_out', 'cleared', 'interrupted'].includes(endReason)) throw new Error('Invalid GROUP result data.')
      const opens = array(round.opens).map((openValue) => {
        const opened = object(openValue)
        return { openOrder: integer(opened.openOrder), bagNumber: integer(opened.bagNumber) }
      })
      if (integer(round.openedBagCount) !== opens.length) throw new Error('Invalid GROUP result data.')
      return {
        roundNumber: integer(round.roundNumber),
        endReason: endReason as GroupParticipantResultInput['rounds'][number]['endReason'],
        capturedCoins: integer(round.capturedCoins),
        opens,
      }
    }),
  }
}

/** Authenticates and reconstructs an immutable closed-GROUP ranking snapshot. */
export async function getGroupResultForParticipant(groupId: string, participantTokenHash: string): Promise<GroupResultSnapshot | null> {
  const result = await getDatabase().execute<ResultRow>(sql`
    with candidate as materialized (
      select match.*, self.id viewer_participant_id
      from group_matches match
      inner join group_participants self
        on self.group_id = match.id and self.auth_token_hash = ${participantTokenHash}
      where match.id = ${groupId}::uuid
    ), eligible as materialized (
      select participant.*
      from candidate
      inner join group_participants participant on participant.group_id = candidate.id
      where participant.completed_at is not null and participant.excluded_at is null
    )
    select
      candidate.id group_id,
      candidate.total_rounds,
      candidate.player_limit,
      candidate.accepted_count,
      candidate.status,
      (select count(*)::integer from eligible) completed_count,
      case when candidate.status = 'closed' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'roundNumber', placement.round_number,
          'bagCount', placement.bag_count,
          'bombBagNumber', placement.bomb_bag_number,
          'coinBagNumbers', placement.coin_bag_numbers
        ) order by placement.round_number), '[]'::jsonb)
        from group_round_placements placement where placement.group_id = candidate.id
      ) else '[]'::jsonb end placements,
      case when candidate.status = 'closed' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'participantId', participant.id,
          'nickname', participant.display_nickname,
          'isSelf', participant.id = candidate.viewer_participant_id,
          'acceptedAt', participant.accepted_at,
          'rounds', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'roundNumber', attempt.round_number,
              'endReason', attempt.status,
              'capturedCoins', attempt.captured_coins,
              'openedBagCount', attempt.opened_bag_count,
              'opens', (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'openOrder', opened.open_order,
                  'bagNumber', opened.bag_number
                ) order by opened.open_order), '[]'::jsonb)
                from group_round_opens opened
                where opened.group_id = attempt.group_id
                  and opened.participant_id = attempt.participant_id
                  and opened.round_number = attempt.round_number
              )
            ) order by attempt.round_number), '[]'::jsonb)
            from group_round_attempts attempt
            where attempt.group_id = participant.group_id
              and attempt.participant_id = participant.id
          )
        ) order by participant.accepted_at, participant.id), '[]'::jsonb)
        from eligible participant
      ) else '[]'::jsonb end participants
    from candidate
  `)
  const row = result.rows[0]
  if (!row) return null
  if (row.status === 'open') return { kind: 'open' }

  const placements = array(row.placements).map((value) => {
    const placement = object(value)
    return {
      roundNumber: integer(placement.roundNumber),
      bagCount: integer(placement.bagCount),
      bombBagNumber: integer(placement.bombBagNumber),
      coinBagNumbers: array(placement.coinBagNumbers).map(integer) as [number, number, number],
    }
  })
  const inputs = array(row.participants).map((value) => participantInput(value, placements, row.total_rounds))
  const presentation = new Map(inputs.map((input) => [input.participantId, { nickname: input.nickname, isSelf: input.isSelf }]))
  const ranking = rankGroupParticipants(inputs.map(aggregateGroupParticipantResult)).map((summary) => ({
    rank: summary.rank,
    nickname: presentation.get(summary.participantId)!.nickname,
    isSelf: presentation.get(summary.participantId)!.isSelf,
    totalCoins: summary.totalCapturedCoins,
    threeCoinsComplete: summary.threeCoinsComplete,
    coinBagHits: summary.coinBagHits,
    totalOpens: summary.totalOpens,
    coinBagHitRate: summary.hitRate,
  }))
  if (placements.length !== row.total_rounds || inputs.length !== row.completed_count) throw new Error('Invalid GROUP result data.')
  return { kind: 'closed', view: {
    groupId: row.group_id,
    totalRounds: row.total_rounds,
    playerLimit: row.player_limit,
    acceptedCount: row.accepted_count,
    completedCount: row.completed_count,
    status: 'closed',
    ranking,
  } }
}
