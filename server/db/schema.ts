import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const duelMatches = pgTable(
  'duel_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    totalRounds: smallint('total_rounds').notNull(),
    createRequestId: uuid('create_request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    formationVersion: smallint('formation_version').default(1).notNull(),
    ruleVersion: smallint('rule_version').default(1).notNull(),
  },
  (table) => [
    unique('duel_matches_create_request_id_unique').on(table.createRequestId),
    check(
      'duel_matches_total_rounds_check',
      sql`${table.totalRounds} between 1 and 20`,
    ),
    check(
      'duel_matches_formation_version_check',
      sql`${table.formationVersion} >= 1`,
    ),
    check('duel_matches_rule_version_check', sql`${table.ruleVersion} >= 1`),
  ],
)

export const duelParticipants = pgTable(
  'duel_participants',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => duelMatches.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    /** SHA-256 / HMAC-SHA-256 encoded as 64 lowercase hexadecimal characters. */
    authTokenHash: varchar('auth_token_hash', { length: 64 }),
    /** Present only while participant B has not claimed the invitation. */
    inviteTokenHash: varchar('invite_token_hash', { length: 64 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    placementLockedAt: timestamp('placement_locked_at', { withTimezone: true }),
    version: integer('version').default(0).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'duel_participants_match_id_role_pk',
      columns: [table.matchId, table.role],
    }),
    uniqueIndex('duel_participants_auth_token_hash_unique').on(
      table.authTokenHash,
    ),
    uniqueIndex('duel_participants_invite_token_hash_unique').on(
      table.inviteTokenHash,
    ),
    check(
      'duel_participants_role_check',
      sql`${table.role} in ('A', 'B')`,
    ),
    check(
      'duel_participants_auth_token_hash_check',
      sql`${table.authTokenHash} is null or ${table.authTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'duel_participants_invite_token_hash_check',
      sql`${table.inviteTokenHash} is null or ${table.inviteTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'duel_participants_claim_state_check',
      sql`(
        ${table.role} = 'A'
        and ${table.authTokenHash} is not null
        and ${table.inviteTokenHash} is null
        and ${table.claimedAt} is not null
      ) or (
        ${table.role} = 'B'
        and (
          (
            ${table.authTokenHash} is null
            and ${table.inviteTokenHash} is not null
            and ${table.claimedAt} is null
          ) or (
            ${table.authTokenHash} is not null
            and ${table.inviteTokenHash} is null
            and ${table.claimedAt} is not null
          )
        )
      )`,
    ),
    check('duel_participants_version_check', sql`${table.version} >= 0`),
  ],
)

export const duelRoundPlacements = pgTable(
  'duel_round_placements',
  {
    matchId: uuid('match_id').notNull(),
    participantRole: text('participant_role').notNull(),
    roundNumber: smallint('round_number').notNull(),
    bagCount: smallint('bag_count').notNull(),
    bombBagNumber: smallint('bomb_bag_number').notNull(),
    /** Three bag numbers, one per coin, stored in non-decreasing order. */
    coinBagNumbers: smallint('coin_bag_numbers').array().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'duel_round_placements_match_role_round_pk',
      columns: [table.matchId, table.participantRole, table.roundNumber],
    }),
    foreignKey({
      name: 'duel_round_placements_participant_fk',
      columns: [table.matchId, table.participantRole],
      foreignColumns: [duelParticipants.matchId, duelParticipants.role],
    }).onDelete('cascade'),
    check(
      'duel_round_placements_participant_role_check',
      sql`${table.participantRole} in ('A', 'B')`,
    ),
    check(
      'duel_round_placements_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'duel_round_placements_bag_count_check',
      sql`${table.bagCount} between 3 and 8`,
    ),
    check(
      'duel_round_placements_bomb_bag_number_check',
      sql`${table.bombBagNumber} between 1 and ${table.bagCount}`,
    ),
    check(
      'duel_round_placements_coin_count_check',
      sql`array_ndims(${table.coinBagNumbers}) = 1
        and cardinality(${table.coinBagNumbers}) = 3
        and array_lower(${table.coinBagNumbers}, 1) = 1
        and array_upper(${table.coinBagNumbers}, 1) = 3
        and array_position(${table.coinBagNumbers}, null) is null`,
    ),
    check(
      'duel_round_placements_coin_bag_numbers_check',
      sql`(
        (${table.coinBagNumbers})[1] between 1 and ${table.bagCount}
        and (${table.coinBagNumbers})[2] between 1 and ${table.bagCount}
        and (${table.coinBagNumbers})[3] between 1 and ${table.bagCount}
        and (${table.coinBagNumbers})[1] <> ${table.bombBagNumber}
        and (${table.coinBagNumbers})[2] <> ${table.bombBagNumber}
        and (${table.coinBagNumbers})[3] <> ${table.bombBagNumber}
        and (${table.coinBagNumbers})[1] <= (${table.coinBagNumbers})[2]
        and (${table.coinBagNumbers})[2] <= (${table.coinBagNumbers})[3]
      )`,
    ),
  ],
)

export const duelRoundOpens = pgTable(
  'duel_round_opens',
  {
    matchId: uuid('match_id').notNull(),
    roundNumber: smallint('round_number').notNull(),
    explorerRole: text('explorer_role').notNull(),
    placementRole: text('placement_role').notNull(),
    openOrder: smallint('open_order').notNull(),
    bagNumber: smallint('bag_number').notNull(),
    requestId: uuid('request_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'duel_round_opens_match_explorer_round_order_pk',
      columns: [
        table.matchId,
        table.explorerRole,
        table.roundNumber,
        table.openOrder,
      ],
    }),
    foreignKey({
      name: 'duel_round_opens_explorer_fk',
      columns: [table.matchId, table.explorerRole],
      foreignColumns: [duelParticipants.matchId, duelParticipants.role],
    }).onDelete('cascade'),
    foreignKey({
      name: 'duel_round_opens_placement_fk',
      columns: [table.matchId, table.placementRole, table.roundNumber],
      foreignColumns: [
        duelRoundPlacements.matchId,
        duelRoundPlacements.participantRole,
        duelRoundPlacements.roundNumber,
      ],
    }).onDelete('cascade'),
    unique('duel_round_opens_match_explorer_round_bag_unique').on(
      table.matchId,
      table.explorerRole,
      table.roundNumber,
      table.bagNumber,
    ),
    unique('duel_round_opens_request_id_unique').on(table.requestId),
    check(
      'duel_round_opens_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'duel_round_opens_roles_check',
      sql`${table.explorerRole} in ('A', 'B') and ${table.placementRole} in ('A', 'B') and ${table.explorerRole} <> ${table.placementRole}`,
    ),
    check('duel_round_opens_open_order_check', sql`${table.openOrder} >= 1`),
    check(
      'duel_round_opens_bag_number_check',
      sql`${table.bagNumber} between 1 and 8`,
    ),
  ],
)

export const duelRoundResults = pgTable(
  'duel_round_results',
  {
    matchId: uuid('match_id').notNull(),
    roundNumber: smallint('round_number').notNull(),
    explorerRole: text('explorer_role').notNull(),
    placementRole: text('placement_role').notNull(),
    endReason: text('end_reason').notNull(),
    terminalOpenOrder: smallint('terminal_open_order'),
    capturedCoins: smallint('captured_coins').notNull(),
    bombHit: boolean('bomb_hit').notNull(),
    openedBagCount: smallint('opened_bag_count').notNull(),
    requestId: uuid('request_id'),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'duel_round_results_match_explorer_round_pk',
      columns: [table.matchId, table.explorerRole, table.roundNumber],
    }),
    foreignKey({
      name: 'duel_round_results_explorer_fk',
      columns: [table.matchId, table.explorerRole],
      foreignColumns: [duelParticipants.matchId, duelParticipants.role],
    }).onDelete('cascade'),
    foreignKey({
      name: 'duel_round_results_placement_fk',
      columns: [table.matchId, table.placementRole, table.roundNumber],
      foreignColumns: [
        duelRoundPlacements.matchId,
        duelRoundPlacements.participantRole,
        duelRoundPlacements.roundNumber,
      ],
    }).onDelete('cascade'),
    unique('duel_round_results_request_id_unique').on(table.requestId),
    check(
      'duel_round_results_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'duel_round_results_roles_check',
      sql`${table.explorerRole} in ('A', 'B') and ${table.placementRole} in ('A', 'B') and ${table.explorerRole} <> ${table.placementRole}`,
    ),
    check(
      'duel_round_results_end_reason_check',
      sql`${table.endReason} in ('bombed', 'cashed_out', 'cleared')`,
    ),
    check(
      'duel_round_results_captured_coins_check',
      sql`${table.capturedCoins} between 0 and 3`,
    ),
    check(
      'duel_round_results_opened_bag_count_check',
      sql`${table.openedBagCount} between 1 and 8`,
    ),
    check(
      'duel_round_results_terminal_open_order_check',
      sql`${table.terminalOpenOrder} is null or ${table.terminalOpenOrder} between 1 and ${table.openedBagCount}`,
    ),
    check(
      'duel_round_results_state_check',
      sql`(
        ${table.endReason} = 'bombed'
        and ${table.bombHit} = true
        and ${table.capturedCoins} = 0
        and ${table.terminalOpenOrder} = ${table.openedBagCount}
      ) or (
        ${table.endReason} = 'cashed_out'
        and ${table.bombHit} = false
        and ${table.capturedCoins} in (1, 2)
        and ${table.terminalOpenOrder} is null
      ) or (
        ${table.endReason} = 'cleared'
        and ${table.bombHit} = false
        and ${table.capturedCoins} = 3
        and ${table.terminalOpenOrder} = ${table.openedBagCount}
      )`,
    ),
  ],
)

export type DuelMatchRow = typeof duelMatches.$inferSelect
export type NewDuelMatchRow = typeof duelMatches.$inferInsert
export type DuelParticipantRow = typeof duelParticipants.$inferSelect
export type NewDuelParticipantRow = typeof duelParticipants.$inferInsert
export type DuelRoundPlacementRow = typeof duelRoundPlacements.$inferSelect
export type NewDuelRoundPlacementRow = typeof duelRoundPlacements.$inferInsert
export type DuelRoundOpenRow = typeof duelRoundOpens.$inferSelect
export type NewDuelRoundOpenRow = typeof duelRoundOpens.$inferInsert
export type DuelRoundResultRow = typeof duelRoundResults.$inferSelect
export type NewDuelRoundResultRow = typeof duelRoundResults.$inferInsert
