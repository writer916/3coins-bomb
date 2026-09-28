/** DUEL database schema and migration checks (no database connection). */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { getDatabase } from '../server/db/client.ts'
import { duelMatches, duelParticipants } from '../server/db/schema.ts'

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

assert.equal(matches.name, 'duel_matches')
assert.deepEqual(columnNames(duelMatches), [
  'id',
  'total_rounds',
  'create_request_id',
  'created_at',
  'updated_at',
  'expires_at',
])
assert.equal(duelMatches.id.primary, true)
assert.equal(duelMatches.totalRounds.notNull, true)
assert.equal(duelMatches.createRequestId.notNull, true)
assert.equal(
  matches.uniqueConstraints.some(
    (constraint) =>
      constraint.getName() === 'duel_matches_create_request_id_unique',
  ),
  true,
)
assert.equal(
  matches.checks.some(
    (constraint) => constraint.name === 'duel_matches_total_rounds_check',
  ),
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
  participants.primaryKeys.some(
    (key) =>
      key.getName() === 'duel_participants_match_id_role_pk' &&
      key.columns.map((column) => column.name).join(',') === 'match_id,role',
  ),
  true,
)
assert.equal(
  participants.checks.some(
    (constraint) => constraint.name === 'duel_participants_role_check',
  ),
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

const migrationDirectory = join(root, 'drizzle')
const migrations = filesBelow(migrationDirectory).filter((path) => path.endsWith('.sql'))
assert.equal(migrations.length, 1)
const migration = readFileSync(migrations[0], 'utf8')

const requiredSql = [
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
for (const fragment of requiredSql) {
  assert.equal(migration.includes(fragment), true, `migration missing: ${fragment}`)
}
assert.equal(migration.includes('duel_round_placements'), false)
assert.equal(migration.includes('duel_round_results'), false)

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
