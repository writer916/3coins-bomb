import { sql } from 'drizzle-orm'
import {
  check,
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
  },
  (table) => [
    unique('duel_matches_create_request_id_unique').on(table.createRequestId),
    check(
      'duel_matches_total_rounds_check',
      sql`${table.totalRounds} between 1 and 20`,
    ),
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

export type DuelMatchRow = typeof duelMatches.$inferSelect
export type NewDuelMatchRow = typeof duelMatches.$inferInsert
export type DuelParticipantRow = typeof duelParticipants.$inferSelect
export type NewDuelParticipantRow = typeof duelParticipants.$inferInsert
