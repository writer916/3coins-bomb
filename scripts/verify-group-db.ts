/** GROUP database schema and additive migration checks (no database connection). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  groupMatches,
  groupParticipants,
  groupRoundAttempts,
  groupRoundOpens,
  groupRoundPlacements,
} from '../server/db/schema.ts'

const root = resolve(import.meta.dirname, '..')

function columns(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name)
}

function hasPrimaryKey(
  table: ReturnType<typeof getTableConfig>,
  name: string,
  columnList: string,
): boolean {
  return table.primaryKeys.some(
    (key) =>
      key.getName() === name &&
      key.columns.map((column) => column.name).join(',') === columnList,
  )
}

function hasCheck(
  table: ReturnType<typeof getTableConfig>,
  name: string,
): boolean {
  return table.checks.some((constraint) => constraint.name === name)
}

function hasUnique(
  table: ReturnType<typeof getTableConfig>,
  name: string,
): boolean {
  return table.uniqueConstraints.some(
    (constraint) => constraint.getName() === name,
  )
}

function hasIndex(
  table: ReturnType<typeof getTableConfig>,
  name: string,
  unique: boolean,
): boolean {
  return table.indexes.some(
    (candidate) => candidate.config.name === name && candidate.config.unique === unique,
  )
}

function hasForeignKey(
  table: ReturnType<typeof getTableConfig>,
  name: string,
  columnList: string,
  foreignTable: string,
  foreignColumnList: string,
  onDelete: 'cascade' | 'set null',
): boolean {
  return table.foreignKeys.some((key) => {
    const reference = key.reference()
    return (
      key.getName() === name &&
      key.onDelete === onDelete &&
      reference.columns.map((column) => column.name).join(',') === columnList &&
      getTableConfig(reference.foreignTable).name === foreignTable &&
      reference.foreignColumns.map((column) => column.name).join(',') ===
        foreignColumnList
    )
  })
}

const matches = getTableConfig(groupMatches)
const participants = getTableConfig(groupParticipants)
const placements = getTableConfig(groupRoundPlacements)
const attempts = getTableConfig(groupRoundAttempts)
const opens = getTableConfig(groupRoundOpens)

assert.deepEqual(columns(groupMatches), [
  'id', 'total_rounds', 'player_limit', 'accepted_count', 'status', 'create_request_id',
  'invite_token_hash', 'host_token_hash', 'host_participant_id', 'created_at',
  'updated_at', 'closed_at', 'expires_at', 'formation_version', 'rule_version',
  'scoring_version',
])
assert.equal(groupMatches.id.primary, true)
assert.equal(groupMatches.status.default, 'open')
assert.equal(groupMatches.expiresAt.notNull, false, 'no expiry policy is imposed')
assert.equal(hasUnique(matches, 'group_matches_create_request_id_unique'), true)
assert.equal(hasIndex(matches, 'group_matches_invite_token_hash_unique', true), true)
assert.equal(hasIndex(matches, 'group_matches_host_token_hash_unique', true), true)
assert.equal(hasForeignKey(
  matches,
  'group_matches_host_participant_id_group_participants_id_fk',
  'host_participant_id',
  'group_participants',
  'id',
  'set null',
), true)
for (const name of [
  'group_matches_total_rounds_check',
  'group_matches_player_limit_check',
  'group_matches_accepted_count_check',
  'group_matches_status_check',
  'group_matches_closed_state_check',
  'group_matches_invite_token_hash_check',
  'group_matches_host_token_hash_check',
  'group_matches_formation_version_check',
  'group_matches_rule_version_check',
  'group_matches_scoring_version_check',
]) assert.equal(hasCheck(matches, name), true, `missing schema check: ${name}`)

assert.deepEqual(columns(groupRoundPlacements), [
  'group_id', 'round_number', 'bag_count', 'bomb_bag_number',
  'coin_bag_numbers', 'source', 'created_at',
])
assert.equal(groupRoundPlacements.coinBagNumbers.columnType, 'PgArray')
assert.equal(hasPrimaryKey(
  placements,
  'group_round_placements_group_round_pk',
  'group_id,round_number',
), true)
assert.equal(hasForeignKey(
  placements,
  'group_round_placements_group_id_group_matches_id_fk',
  'group_id',
  'group_matches',
  'id',
  'cascade',
), true)
for (const name of [
  'group_round_placements_round_number_check',
  'group_round_placements_bag_count_check',
  'group_round_placements_bomb_bag_number_check',
  'group_round_placements_source_check',
  'group_round_placements_coin_count_check',
  'group_round_placements_coin_bag_numbers_check',
]) assert.equal(hasCheck(placements, name), true, `missing schema check: ${name}`)

assert.deepEqual(columns(groupParticipants), [
  'id', 'group_id', 'display_nickname', 'nickname_key', 'auth_token_hash',
  'accepted_at', 'completed_at', 'excluded_at', 'version',
])
assert.equal(groupParticipants.displayNickname.columnType, 'PgText')
assert.equal(groupParticipants.nicknameKey.columnType, 'PgText')
assert.equal(hasUnique(participants, 'group_participants_group_id_id_unique'), true)
assert.equal(
  hasUnique(participants, 'group_participants_group_nickname_key_unique'),
  true,
)
assert.equal(
  hasIndex(participants, 'group_participants_auth_token_hash_unique', true),
  true,
)
assert.equal(
  hasIndex(participants, 'group_participants_group_progress_idx', false),
  true,
)
assert.equal(hasForeignKey(
  participants,
  'group_participants_group_id_group_matches_id_fk',
  'group_id',
  'group_matches',
  'id',
  'cascade',
), true)

assert.deepEqual(columns(groupRoundAttempts), [
  'participant_id', 'group_id', 'round_number', 'status', 'started_at',
  'ended_at', 'captured_coins', 'opened_bag_count', 'start_request_id',
  'terminal_request_id', 'version',
])
assert.equal(hasPrimaryKey(
  attempts,
  'group_round_attempts_participant_round_pk',
  'participant_id,round_number',
), true)
for (const name of [
  'group_round_attempts_group_participant_round_unique',
  'group_round_attempts_start_request_id_unique',
  'group_round_attempts_terminal_request_id_unique',
]) assert.equal(hasUnique(attempts, name), true, `missing unique: ${name}`)
assert.equal(hasForeignKey(
  attempts,
  'group_round_attempts_participant_fk',
  'group_id,participant_id',
  'group_participants',
  'group_id,id',
  'cascade',
), true)
assert.equal(hasForeignKey(
  attempts,
  'group_round_attempts_placement_fk',
  'group_id,round_number',
  'group_round_placements',
  'group_id,round_number',
  'cascade',
), true)
assert.equal(hasIndex(attempts, 'group_round_attempts_group_status_idx', false), true)
for (const name of [
  'group_round_attempts_round_number_check',
  'group_round_attempts_status_check',
  'group_round_attempts_captured_coins_check',
  'group_round_attempts_opened_bag_count_check',
  'group_round_attempts_state_check',
  'group_round_attempts_version_check',
]) assert.equal(hasCheck(attempts, name), true, `missing schema check: ${name}`)

assert.deepEqual(columns(groupRoundOpens), [
  'participant_id', 'group_id', 'round_number', 'open_order', 'bag_number',
  'request_id', 'opened_at',
])
assert.equal(hasPrimaryKey(
  opens,
  'group_round_opens_participant_round_order_pk',
  'participant_id,round_number,open_order',
), true)
for (const name of [
  'group_round_opens_group_participant_round_order_unique',
  'group_round_opens_participant_round_bag_unique',
  'group_round_opens_request_id_unique',
]) assert.equal(hasUnique(opens, name), true, `missing unique: ${name}`)
assert.equal(hasForeignKey(
  opens,
  'group_round_opens_attempt_fk',
  'group_id,participant_id,round_number',
  'group_round_attempts',
  'group_id,participant_id,round_number',
  'cascade',
), true)

const migration = readFileSync(
  join(root, 'drizzle', '0002_futuristic_nocturne.sql'),
  'utf8',
)
for (const fragment of [
  'CREATE TABLE "group_matches"',
  'CREATE TABLE "group_participants"',
  'CREATE TABLE "group_round_attempts"',
  'CREATE TABLE "group_round_opens"',
  'CREATE TABLE "group_round_placements"',
  '"total_rounds" between 1 and 20',
  '"player_limit" between 2 and 20',
  "in ('generated', 'duel-history')",
  "in ('active', 'bombed', 'cashed_out', 'cleared', 'interrupted')",
  'CONSTRAINT "group_participants_group_nickname_key_unique" UNIQUE',
  'CONSTRAINT "group_round_attempts_start_request_id_unique" UNIQUE',
  'CONSTRAINT "group_round_opens_request_id_unique" UNIQUE',
  'CONSTRAINT "group_round_opens_attempt_fk" FOREIGN KEY',
]) assert.equal(migration.includes(fragment), true, `migration missing: ${fragment}`)

for (const destructive of [
  'DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM',
]) {
  assert.equal(
    migration.includes(destructive),
    false,
    `unexpected destructive SQL: ${destructive}`,
  )
}
assert.equal(migration.includes('ALTER TABLE "duel_'), false)
assert.equal(migration.includes('CREATE TABLE "duel_'), false)

const capacityMigration = readFileSync(
  join(root, 'drizzle', '0003_silent_the_fury.sql'),
  'utf8',
)
for (const fragment of [
  'ADD COLUMN "accepted_count" smallint DEFAULT 0 NOT NULL',
  'CONSTRAINT "group_matches_accepted_count_check"',
  '"accepted_count" between 0 and "group_matches"."player_limit"',
]) assert.equal(
  capacityMigration.includes(fragment),
  true,
  `capacity migration missing: ${fragment}`,
)
for (const destructive of ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM']) {
  assert.equal(capacityMigration.includes(destructive), false)
}

const openMigration = readFileSync(join(root, 'drizzle', '0004_rare_paladin.sql'), 'utf8')
/* Historical migration loosened bombed captured_coins; current schema restores = 0. */
assert.match(openMigration, /captured_coins" between 0 and 2/)
assert.equal(openMigration.includes('ALTER TABLE "duel_'), false)
const schemaSource = readFileSync(join(root, 'server', 'db', 'schema.ts'), 'utf8')
assert.match(
  schemaSource,
  /\$\{table\.status\} = 'bombed'[\s\S]*?\$\{table\.capturedCoins\} = 0/,
)
assert.doesNotMatch(
  schemaSource,
  /\$\{table\.status\} = 'bombed'[\s\S]*?\$\{table\.capturedCoins\} between 0 and 2/,
)

console.log('verify:group-db OK')
