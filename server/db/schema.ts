import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
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

export const groupMatches = pgTable(
  'group_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    totalRounds: smallint('total_rounds').notNull(),
    playerLimit: smallint('player_limit').notNull(),
    /** Atomically reserves capacity for new participants under concurrent joins. */
    acceptedCount: smallint('accepted_count').default(0).notNull(),
    status: text('status').default('open').notNull(),
    createRequestId: uuid('create_request_id').notNull(),
    /** SHA-256 / HMAC-SHA-256 encoded as 64 lowercase hexadecimal characters. */
    inviteTokenHash: varchar('invite_token_hash', { length: 64 }).notNull(),
    /** Separate capability for the future host-only close operation. */
    hostTokenHash: varchar('host_token_hash', { length: 64 }).notNull(),
    /** Set after the host joins as an ordinary participant with a nickname. */
    hostParticipantId: uuid('host_participant_id').references(
      (): AnyPgColumn => groupParticipants.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Reserved for a future expiry policy; no expiry is assigned by this schema. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    formationVersion: smallint('formation_version').default(1).notNull(),
    ruleVersion: smallint('rule_version').default(1).notNull(),
    scoringVersion: smallint('scoring_version').default(1).notNull(),
  },
  (table) => [
    unique('group_matches_create_request_id_unique').on(table.createRequestId),
    uniqueIndex('group_matches_invite_token_hash_unique').on(
      table.inviteTokenHash,
    ),
    uniqueIndex('group_matches_host_token_hash_unique').on(table.hostTokenHash),
    check(
      'group_matches_total_rounds_check',
      sql`${table.totalRounds} between 1 and 20`,
    ),
    check(
      'group_matches_player_limit_check',
      sql`${table.playerLimit} between 2 and 20`,
    ),
    check(
      'group_matches_accepted_count_check',
      sql`${table.acceptedCount} between 0 and ${table.playerLimit}`,
    ),
    check(
      'group_matches_status_check',
      sql`${table.status} in ('open', 'closed')`,
    ),
    check(
      'group_matches_closed_state_check',
      sql`(
        ${table.status} = 'open' and ${table.closedAt} is null
      ) or (
        ${table.status} = 'closed' and ${table.closedAt} is not null
      )`,
    ),
    check(
      'group_matches_invite_token_hash_check',
      sql`${table.inviteTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'group_matches_host_token_hash_check',
      sql`${table.hostTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'group_matches_formation_version_check',
      sql`${table.formationVersion} >= 1`,
    ),
    check('group_matches_rule_version_check', sql`${table.ruleVersion} >= 1`),
    check(
      'group_matches_scoring_version_check',
      sql`${table.scoringVersion} >= 1`,
    ),
  ],
)

export const groupRoundPlacements = pgTable(
  'group_round_placements',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groupMatches.id, { onDelete: 'cascade' }),
    roundNumber: smallint('round_number').notNull(),
    bagCount: smallint('bag_count').notNull(),
    bombBagNumber: smallint('bomb_bag_number').notNull(),
    /** Three bag numbers, one per coin, stored in non-decreasing order. */
    coinBagNumbers: smallint('coin_bag_numbers').array().notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'group_round_placements_group_round_pk',
      columns: [table.groupId, table.roundNumber],
    }),
    check(
      'group_round_placements_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'group_round_placements_bag_count_check',
      sql`${table.bagCount} between 3 and 8`,
    ),
    check(
      'group_round_placements_bomb_bag_number_check',
      sql`${table.bombBagNumber} between 1 and ${table.bagCount}`,
    ),
    check(
      'group_round_placements_source_check',
      sql`${table.source} in ('generated', 'duel-history')`,
    ),
    check(
      'group_round_placements_coin_count_check',
      sql`array_ndims(${table.coinBagNumbers}) = 1
        and cardinality(${table.coinBagNumbers}) = 3
        and array_lower(${table.coinBagNumbers}, 1) = 1
        and array_upper(${table.coinBagNumbers}, 1) = 3
        and array_position(${table.coinBagNumbers}, null) is null`,
    ),
    check(
      'group_round_placements_coin_bag_numbers_check',
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

export const groupParticipants = pgTable(
  'group_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groupMatches.id, { onDelete: 'cascade' }),
    displayNickname: text('display_nickname').notNull(),
    /** NFC-normalized, case-sensitive duplicate key from the pure GROUP domain. */
    nicknameKey: text('nickname_key').notNull(),
    /** Session capability; nickname remains the cross-device recovery input. */
    authTokenHash: varchar('auth_token_hash', { length: 64 }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Set on incomplete participants when the host closes the GROUP early. */
    excludedAt: timestamp('excluded_at', { withTimezone: true }),
    version: integer('version').default(0).notNull(),
  },
  (table) => [
    unique('group_participants_group_id_id_unique').on(table.groupId, table.id),
    unique('group_participants_group_nickname_key_unique').on(
      table.groupId,
      table.nicknameKey,
    ),
    uniqueIndex('group_participants_auth_token_hash_unique').on(
      table.authTokenHash,
    ),
    index('group_participants_group_progress_idx').on(
      table.groupId,
      table.completedAt,
      table.excludedAt,
    ),
    check(
      'group_participants_display_nickname_nonempty_check',
      sql`char_length(${table.displayNickname}) > 0`,
    ),
    check(
      'group_participants_nickname_key_nonempty_check',
      sql`char_length(${table.nicknameKey}) > 0`,
    ),
    check(
      'group_participants_auth_token_hash_check',
      sql`${table.authTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'group_participants_completion_exclusion_check',
      sql`${table.completedAt} is null or ${table.excludedAt} is null`,
    ),
    check('group_participants_version_check', sql`${table.version} >= 0`),
  ],
)

export const groupRoundAttempts = pgTable(
  'group_round_attempts',
  {
    participantId: uuid('participant_id').notNull(),
    groupId: uuid('group_id').notNull(),
    roundNumber: smallint('round_number').notNull(),
    status: text('status').default('active').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    capturedCoins: smallint('captured_coins').default(0).notNull(),
    openedBagCount: smallint('opened_bag_count').default(0).notNull(),
    startRequestId: uuid('start_request_id').notNull(),
    terminalRequestId: uuid('terminal_request_id'),
    version: integer('version').default(0).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'group_round_attempts_participant_round_pk',
      columns: [table.participantId, table.roundNumber],
    }),
    unique('group_round_attempts_group_participant_round_unique').on(
      table.groupId,
      table.participantId,
      table.roundNumber,
    ),
    unique('group_round_attempts_start_request_id_unique').on(
      table.startRequestId,
    ),
    unique('group_round_attempts_terminal_request_id_unique').on(
      table.terminalRequestId,
    ),
    foreignKey({
      name: 'group_round_attempts_participant_fk',
      columns: [table.groupId, table.participantId],
      foreignColumns: [groupParticipants.groupId, groupParticipants.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'group_round_attempts_placement_fk',
      columns: [table.groupId, table.roundNumber],
      foreignColumns: [groupRoundPlacements.groupId, groupRoundPlacements.roundNumber],
    }).onDelete('cascade'),
    index('group_round_attempts_group_status_idx').on(
      table.groupId,
      table.status,
    ),
    check(
      'group_round_attempts_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'group_round_attempts_status_check',
      sql`${table.status} in ('active', 'bombed', 'cashed_out', 'cleared', 'interrupted')`,
    ),
    check(
      'group_round_attempts_captured_coins_check',
      sql`${table.capturedCoins} between 0 and 3`,
    ),
    check(
      'group_round_attempts_opened_bag_count_check',
      sql`${table.openedBagCount} between 0 and 8`,
    ),
    check(
      'group_round_attempts_state_check',
      sql`(
        ${table.status} = 'active'
        and ${table.endedAt} is null
        and ${table.terminalRequestId} is null
        and ${table.capturedCoins} = 0
      ) or (
        ${table.status} = 'bombed'
        and ${table.endedAt} is not null
        and ${table.terminalRequestId} is not null
        and ${table.capturedCoins} = 0
        and ${table.openedBagCount} between 1 and 8
      ) or (
        ${table.status} = 'cashed_out'
        and ${table.endedAt} is not null
        and ${table.terminalRequestId} is not null
        and ${table.capturedCoins} in (1, 2)
        and ${table.openedBagCount} between 1 and 8
      ) or (
        ${table.status} = 'cleared'
        and ${table.endedAt} is not null
        and ${table.terminalRequestId} is not null
        and ${table.capturedCoins} = 3
        and ${table.openedBagCount} between 1 and 8
      ) or (
        ${table.status} = 'interrupted'
        and ${table.endedAt} is not null
        and ${table.terminalRequestId} is not null
        and ${table.capturedCoins} = 0
      )`,
    ),
    check('group_round_attempts_version_check', sql`${table.version} >= 0`),
  ],
)

export const groupRoundOpens = pgTable(
  'group_round_opens',
  {
    participantId: uuid('participant_id').notNull(),
    groupId: uuid('group_id').notNull(),
    roundNumber: smallint('round_number').notNull(),
    openOrder: smallint('open_order').notNull(),
    bagNumber: smallint('bag_number').notNull(),
    requestId: uuid('request_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'group_round_opens_participant_round_order_pk',
      columns: [table.participantId, table.roundNumber, table.openOrder],
    }),
    unique('group_round_opens_group_participant_round_order_unique').on(
      table.groupId,
      table.participantId,
      table.roundNumber,
      table.openOrder,
    ),
    unique('group_round_opens_participant_round_bag_unique').on(
      table.participantId,
      table.roundNumber,
      table.bagNumber,
    ),
    unique('group_round_opens_request_id_unique').on(table.requestId),
    foreignKey({
      name: 'group_round_opens_attempt_fk',
      columns: [table.groupId, table.participantId, table.roundNumber],
      foreignColumns: [
        groupRoundAttempts.groupId,
        groupRoundAttempts.participantId,
        groupRoundAttempts.roundNumber,
      ],
    }).onDelete('cascade'),
    check(
      'group_round_opens_round_number_check',
      sql`${table.roundNumber} between 1 and 20`,
    ),
    check(
      'group_round_opens_open_order_check',
      sql`${table.openOrder} between 1 and 8`,
    ),
    check(
      'group_round_opens_bag_number_check',
      sql`${table.bagNumber} between 1 and 8`,
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
export type GroupMatchRow = typeof groupMatches.$inferSelect
export type NewGroupMatchRow = typeof groupMatches.$inferInsert
export type GroupRoundPlacementRow = typeof groupRoundPlacements.$inferSelect
export type NewGroupRoundPlacementRow = typeof groupRoundPlacements.$inferInsert
export type GroupParticipantRow = typeof groupParticipants.$inferSelect
export type NewGroupParticipantRow = typeof groupParticipants.$inferInsert
export type GroupRoundAttemptRow = typeof groupRoundAttempts.$inferSelect
export type NewGroupRoundAttemptRow = typeof groupRoundAttempts.$inferInsert
export type GroupRoundOpenRow = typeof groupRoundOpens.$inferSelect
export type NewGroupRoundOpenRow = typeof groupRoundOpens.$inferInsert
