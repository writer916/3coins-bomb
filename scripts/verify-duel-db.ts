/** DUEL database schema and migration checks (no database connection). */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { getDatabase } from '../server/db/client.ts'
import {
  duelMatches,
  duelParticipants,
  duelRoundOpens,
  duelRoundPlacements,
  duelRoundResults,
} from '../server/db/schema.ts'

const root = resolve(import.meta.dirname, '..')

function filesBelow(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) result.push(...filesBelow(path))
    else result.push(path)
  }
  return result
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name)
}

const matches = getTableConfig(duelMatches)
const participants = getTableConfig(duelParticipants)
const placements = getTableConfig(duelRoundPlacements)
const opens = getTableConfig(duelRoundOpens)
const results = getTableConfig(duelRoundResults)

function hasPrimaryKey(
  table: ReturnType<typeof getTableConfig>,
  name: string,
  columns: string,
): boolean {
  return table.primaryKeys.some(
    (key) =>
      key.getName() === name &&
      key.columns.map((column) => column.name).join(',') === columns,
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

function hasForeignKey(
  table: ReturnType<typeof getTableConfig>,
  name: string,
  columns: string,
  foreignTable: string,
  foreignColumns: string,
): boolean {
  return table.foreignKeys.some((key) => {
    const reference = key.reference()
    return (
      key.getName() === name &&
      key.onDelete === 'cascade' &&
      reference.columns.map((column) => column.name).join(',') === columns &&
      getTableConfig(reference.foreignTable).name === foreignTable &&
      reference.foreignColumns.map((column) => column.name).join(',') ===
        foreignColumns
    )
  })
}

assert.equal(matches.name, 'duel_matches')
assert.deepEqual(columnNames(duelMatches), [
  'id',
  'total_rounds',
  'create_request_id',
  'created_at',
  'updated_at',
  'expires_at',
  'formation_version',
  'rule_version',
])
assert.equal(duelMatches.id.primary, true)
assert.equal(duelMatches.totalRounds.notNull, true)
assert.equal(duelMatches.createRequestId.notNull, true)
assert.equal(duelMatches.formationVersion.default, 1)
assert.equal(duelMatches.formationVersion.notNull, true)
assert.equal(duelMatches.ruleVersion.default, 1)
assert.equal(duelMatches.ruleVersion.notNull, true)
assert.equal(
  matches.uniqueConstraints.some(
    (constraint) =>
      constraint.getName() === 'duel_matches_create_request_id_unique',
  ),
  true,
)
assert.equal(
  hasCheck(matches, 'duel_matches_total_rounds_check'),
  true,
)
assert.equal(
  hasCheck(matches, 'duel_matches_formation_version_check'),
  true,
)
assert.equal(
  hasCheck(matches, 'duel_matches_rule_version_check'),
  true,
)

assert.equal(participants.name, 'duel_participants')
assert.deepEqual(columnNames(duelParticipants), [
  'match_id',
  'role',
  'auth_token_hash',
  'invite_token_hash',
  'claimed_at',
  'placement_locked_at',
  'version',
])
assert.equal(duelParticipants.authTokenHash.columnType, 'PgVarchar')
assert.equal(duelParticipants.authTokenHash.length, 64)
assert.equal(duelParticipants.inviteTokenHash.length, 64)
assert.equal(duelParticipants.version.default, 0)
assert.equal(
  hasPrimaryKey(
    participants,
    'duel_participants_match_id_role_pk',
    'match_id,role',
  ),
  true,
)
assert.equal(
  hasCheck(participants, 'duel_participants_role_check'),
  true,
)
assert.equal(participants.foreignKeys.length, 1)
assert.equal(participants.foreignKeys[0].onDelete, 'cascade')
const participantMatchReference = participants.foreignKeys[0].reference()
assert.equal(participantMatchReference.columns[0].name, 'match_id')
assert.equal(participantMatchReference.foreignColumns[0].name, 'id')
assert.equal(
  getTableConfig(participantMatchReference.foreignTable).name,
  'duel_matches',
)

assert.equal(placements.name, 'duel_round_placements')
assert.deepEqual(columnNames(duelRoundPlacements), [
  'match_id',
  'participant_role',
  'round_number',
  'bag_count',
  'bomb_bag_number',
  'coin_bag_numbers',
  'locked_at',
  'created_at',
])
assert.equal(duelRoundPlacements.coinBagNumbers.columnType, 'PgArray')
assert.equal(
  hasPrimaryKey(
    placements,
    'duel_round_placements_match_role_round_pk',
    'match_id,participant_role,round_number',
  ),
  true,
)
assert.equal(
  hasForeignKey(
    placements,
    'duel_round_placements_participant_fk',
    'match_id,participant_role',
    'duel_participants',
    'match_id,role',
  ),
  true,
)
for (const name of [
  'duel_round_placements_participant_role_check',
  'duel_round_placements_round_number_check',
  'duel_round_placements_bag_count_check',
  'duel_round_placements_bomb_bag_number_check',
  'duel_round_placements_coin_count_check',
  'duel_round_placements_coin_bag_numbers_check',
]) {
  assert.equal(hasCheck(placements, name), true, `missing schema check: ${name}`)
}

assert.equal(opens.name, 'duel_round_opens')
assert.deepEqual(columnNames(duelRoundOpens), [
  'match_id',
  'round_number',
  'explorer_role',
  'placement_role',
  'open_order',
  'bag_number',
  'request_id',
  'opened_at',
])
assert.equal(
  hasPrimaryKey(
    opens,
    'duel_round_opens_match_explorer_round_order_pk',
    'match_id,explorer_role,round_number,open_order',
  ),
  true,
)
assert.equal(
  hasForeignKey(
    opens,
    'duel_round_opens_explorer_fk',
    'match_id,explorer_role',
    'duel_participants',
    'match_id,role',
  ),
  true,
)
assert.equal(
  hasForeignKey(
    opens,
    'duel_round_opens_placement_fk',
    'match_id,placement_role,round_number',
    'duel_round_placements',
    'match_id,participant_role,round_number',
  ),
  true,
)
assert.equal(
  hasUnique(opens, 'duel_round_opens_match_explorer_round_bag_unique'),
  true,
)
assert.equal(hasUnique(opens, 'duel_round_opens_request_id_unique'), true)
for (const name of [
  'duel_round_opens_round_number_check',
  'duel_round_opens_roles_check',
  'duel_round_opens_open_order_check',
  'duel_round_opens_bag_number_check',
]) {
  assert.equal(hasCheck(opens, name), true, `missing schema check: ${name}`)
}

assert.equal(results.name, 'duel_round_results')
assert.deepEqual(columnNames(duelRoundResults), [
  'match_id',
  'round_number',
  'explorer_role',
  'placement_role',
  'end_reason',
  'terminal_open_order',
  'captured_coins',
  'bomb_hit',
  'opened_bag_count',
  'request_id',
  'ended_at',
  'created_at',
])
assert.equal(
  hasPrimaryKey(
    results,
    'duel_round_results_match_explorer_round_pk',
    'match_id,explorer_role,round_number',
  ),
  true,
)
assert.equal(
  hasForeignKey(
    results,
    'duel_round_results_explorer_fk',
    'match_id,explorer_role',
    'duel_participants',
    'match_id,role',
  ),
  true,
)
assert.equal(
  hasForeignKey(
    results,
    'duel_round_results_placement_fk',
    'match_id,placement_role,round_number',
    'duel_round_placements',
    'match_id,participant_role,round_number',
  ),
  true,
)
assert.equal(hasUnique(results, 'duel_round_results_request_id_unique'), true)
for (const name of [
  'duel_round_results_round_number_check',
  'duel_round_results_roles_check',
  'duel_round_results_end_reason_check',
  'duel_round_results_captured_coins_check',
  'duel_round_results_opened_bag_count_check',
  'duel_round_results_terminal_open_order_check',
  'duel_round_results_state_check',
]) {
  assert.equal(hasCheck(results, name), true, `missing schema check: ${name}`)
}

const migrationDirectory = join(root, 'drizzle')
const migrations = filesBelow(migrationDirectory).filter((path) => path.endsWith('.sql'))
assert.equal(migrations.length, 2)
const initialMigration = readFileSync(
  join(migrationDirectory, '0000_abandoned_ulik.sql'),
  'utf8',
)
const migration = readFileSync(
  join(migrationDirectory, '0001_wild_solo.sql'),
  'utf8',
)

const requiredInitialSql = [
  'CREATE TABLE "duel_matches"',
  '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL',
  '"total_rounds" smallint NOT NULL',
  'CONSTRAINT "duel_matches_create_request_id_unique" UNIQUE("create_request_id")',
  'CONSTRAINT "duel_matches_total_rounds_check" CHECK',
  'between 1 and 20',
  'CREATE TABLE "duel_participants"',
  'CONSTRAINT "duel_participants_match_id_role_pk" PRIMARY KEY("match_id","role")',
  'CONSTRAINT "duel_participants_role_check" CHECK',
  "in ('A', 'B')",
  '"auth_token_hash" varchar(64)',
  '"invite_token_hash" varchar(64)',
  '"placement_locked_at" timestamp with time zone',
  '"version" integer DEFAULT 0 NOT NULL',
  'FOREIGN KEY ("match_id") REFERENCES "public"."duel_matches"("id") ON DELETE cascade',
  'CREATE UNIQUE INDEX "duel_participants_auth_token_hash_unique"',
  'CREATE UNIQUE INDEX "duel_participants_invite_token_hash_unique"',
]
for (const fragment of requiredInitialSql) {
  assert.equal(
    initialMigration.includes(fragment),
    true,
    `initial migration missing: ${fragment}`,
  )
}
assert.equal(initialMigration.includes('duel_round_placements'), false)
assert.equal(initialMigration.includes('duel_round_results'), false)

const requiredSql = [
  'CREATE TABLE "duel_round_placements"',
  '"coin_bag_numbers" smallint[] NOT NULL',
  'PRIMARY KEY("match_id","participant_role","round_number")',
  '"bag_count" between 3 and 8',
  'cardinality("duel_round_placements"."coin_bag_numbers") = 3',
  'array_lower("duel_round_placements"."coin_bag_numbers", 1) = 1',
  'array_upper("duel_round_placements"."coin_bag_numbers", 1) = 3',
  'array_position("duel_round_placements"."coin_bag_numbers", null) is null',
  '"coin_bag_numbers")[1] <> "duel_round_placements"."bomb_bag_number"',
  '"coin_bag_numbers")[1] <= ("duel_round_placements"."coin_bag_numbers")[2]',
  'CREATE TABLE "duel_round_opens"',
  'PRIMARY KEY("match_id","explorer_role","round_number","open_order")',
  'CONSTRAINT "duel_round_opens_match_explorer_round_bag_unique" UNIQUE',
  'CONSTRAINT "duel_round_opens_request_id_unique" UNIQUE("request_id")',
  'CREATE TABLE "duel_round_results"',
  'PRIMARY KEY("match_id","explorer_role","round_number")',
  'CONSTRAINT "duel_round_results_request_id_unique" UNIQUE("request_id")',
  '"end_reason" in (\'bombed\', \'cashed_out\', \'cleared\')',
  '"captured_coins" in (1, 2)',
  '"terminal_open_order" is null',
  '"captured_coins" = 0',
  '"captured_coins" = 3',
  'ADD COLUMN "formation_version" smallint DEFAULT 1 NOT NULL',
  'ADD COLUMN "rule_version" smallint DEFAULT 1 NOT NULL',
  'CONSTRAINT "duel_matches_formation_version_check" CHECK',
  'CONSTRAINT "duel_matches_rule_version_check" CHECK',
  'CONSTRAINT "duel_round_opens_explorer_fk" FOREIGN KEY',
  'CONSTRAINT "duel_round_opens_placement_fk" FOREIGN KEY',
  'CONSTRAINT "duel_round_placements_participant_fk" FOREIGN KEY',
  'CONSTRAINT "duel_round_results_explorer_fk" FOREIGN KEY',
  'CONSTRAINT "duel_round_results_placement_fk" FOREIGN KEY',
]
for (const fragment of requiredSql) {
  assert.equal(migration.includes(fragment), true, `migration missing: ${fragment}`)
}
for (const destructive of ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM']) {
  assert.equal(
    migration.includes(destructive),
    false,
    `unexpected destructive SQL: ${destructive}`,
  )
}

const clientFiles = filesBelow(join(root, 'src')).filter((path) =>
  /\.[cm]?[jt]sx?$/.test(path),
)
const forbiddenClientImport = /(?:server\/db|server\\db|drizzle-orm|@neondatabase\/serverless)/
for (const path of clientFiles) {
  assert.equal(
    forbiddenClientImport.test(readFileSync(path, 'utf8')),
    false,
    `client DB import found: ${relative(root, path)}`,
  )
}

const originalDatabaseUrl = process.env.DATABASE_URL
delete process.env.DATABASE_URL
assert.throws(
  () => getDatabase(),
  /DATABASE_URL is required for server-side database access/,
)
if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl

console.log('verify:duel-db OK')
