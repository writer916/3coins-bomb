/** DAILY challenge schema + migration checks (no database connection). */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  dailyChallengeParticipants,
  dailyChallengePlacements,
  dailyChallengeRoundAttempts,
  dailyChallengeRoundOpens,
  dailyChallenges,
} from '../server/db/schema.ts'

const root = resolve(import.meta.dirname, '..')

function columns(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name)
}

function hasCheck(
  table: ReturnType<typeof getTableConfig>,
  name: string,
): boolean {
  return table.checks.some((constraint) => constraint.name === name)
}

const challenges = getTableConfig(dailyChallenges)
const placements = getTableConfig(dailyChallengePlacements)
const participants = getTableConfig(dailyChallengeParticipants)
const attempts = getTableConfig(dailyChallengeRoundAttempts)
const opens = getTableConfig(dailyChallengeRoundOpens)

assert.equal(challenges.name, 'daily_challenges')
assert.deepEqual(columns(dailyChallenges).sort(), [
  'challenge_date',
  'created_at',
  'formation_version',
  'rule_version',
].sort())
assert(
  challenges.columns.some(
    (column) => column.name === 'challenge_date' && column.primary,
  ),
  'challenge_date must be primary key',
)
assert(hasCheck(challenges, 'daily_challenges_formation_version_check'))
assert(hasCheck(challenges, 'daily_challenges_rule_version_check'))

assert.equal(placements.name, 'daily_challenge_placements')
assert.deepEqual(columns(dailyChallengePlacements).sort(), [
  'bag_count',
  'bomb_bag_number',
  'challenge_date',
  'coin_bag_numbers',
  'created_at',
  'round_number',
].sort())
assert(
  placements.primaryKeys.some(
    (key) =>
      key.getName() === 'daily_challenge_placements_date_round_pk' &&
      key.columns.map((column) => column.name).join(',') ===
        'challenge_date,round_number',
  ),
)
for (const name of [
  'daily_challenge_placements_round_number_check',
  'daily_challenge_placements_bag_count_check',
  'daily_challenge_placements_bomb_bag_number_check',
  'daily_challenge_placements_coin_count_check',
  'daily_challenge_placements_coin_bag_numbers_check',
]) {
  assert(hasCheck(placements, name), name)
}
assert(
  placements.foreignKeys.some((key) => {
    const reference = key.reference()
    return (
      getTableConfig(reference.foreignTable).name === 'daily_challenges' &&
      reference.columns.map((column) => column.name).join(',') ===
        'challenge_date' &&
      key.onDelete === 'cascade'
    )
  }),
)

assert.equal(participants.name, 'daily_challenge_participants')
assert.deepEqual(columns(dailyChallengeParticipants).sort(), [
  'accepted_at',
  'auth_token_hash',
  'challenge_date',
  'completed_at',
  'created_at',
  'display_nickname',
  'expired_at',
  'id',
  'join_request_id',
  'nickname_key',
  'question_order',
  'updated_at',
  'version',
].sort())

assert.equal(attempts.name, 'daily_challenge_round_attempts')
assert.deepEqual(columns(dailyChallengeRoundAttempts).sort(), [
  'captured_coins',
  'challenge_date',
  'challenge_round_number',
  'coin_bag_hits',
  'elapsed_seconds',
  'ended_at',
  'opened_bag_count',
  'participant_id',
  'round_number',
  'start_request_id',
  'started_at',
  'status',
  'terminal_request_id',
  'version',
].sort())

assert.equal(opens.name, 'daily_challenge_round_opens')
assert.deepEqual(columns(dailyChallengeRoundOpens).sort(), [
  'bag_number',
  'challenge_date',
  'open_order',
  'opened_at',
  'participant_id',
  'remaining_seconds_at_tap',
  'request_id',
  'round_number',
].sort())

const migrationDir = join(root, 'drizzle')
const migrations = readdirSync(migrationDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
assert.deepEqual(
  migrations.map((name) => name.slice(0, 4)),
  ['0000', '0001', '0002', '0003', '0004', '0005', '0006'],
  'migration numbering must remain contiguous through 0006',
)

const migration0005 = migrations.find((name) => name.startsWith('0005_'))
const migration0006 = migrations.find((name) => name.startsWith('0006_'))
assert.equal(migration0005, '0005_romantic_doctor_faustus.sql')
assert.equal(migration0006, '0006_lazy_major_mapleleaf.sql')

const journal = JSON.parse(
  readFileSync(join(migrationDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> }
assert.deepEqual(
  journal.entries.map(({ idx, tag }) => ({ idx, tag })),
  migrations.map((name, idx) => ({ idx, tag: name.replace(/\.sql$/, '') })),
  'journal entries must match migrations in order',
)
for (const { idx } of journal.entries) {
  assert(
    existsSync(
      join(migrationDir, 'meta', `${String(idx).padStart(4, '0')}_snapshot.json`),
    ),
    `snapshot for migration ${idx} must exist`,
  )
}

const sql0005 = readFileSync(join(migrationDir, migration0005), 'utf8')
assert.match(sql0005, /CREATE TABLE "daily_challenges"/)
assert.match(sql0005, /CREATE TABLE "daily_challenge_placements"/)
assert.match(sql0005, /"challenge_date" date PRIMARY KEY NOT NULL/)
assert.match(sql0005, /daily_challenge_placements_date_round_pk/)
assert.doesNotMatch(sql0005, /group_round_attempts/)
assert.doesNotMatch(sql0005, /duel_/)

const sql0006 = readFileSync(join(migrationDir, migration0006), 'utf8')
for (const table of [
  'daily_challenge_participants',
  'daily_challenge_round_attempts',
  'daily_challenge_round_opens',
]) {
  assert.match(sql0006, new RegExp(`CREATE TABLE "${table}"`), table)
}
assert.doesNotMatch(sql0006, /CREATE TABLE "daily_challenges"/)
assert.doesNotMatch(sql0006, /CREATE TABLE "daily_challenge_placements"/)

for (const constraint of [
  'daily_participants_date_id_unique',
  'daily_participants_join_request_unique',
  'daily_participants_token_hash_unique',
  'daily_participants_display_nickname_nonempty_check',
  'daily_participants_nickname_key_nonempty_check',
  'daily_participants_auth_token_hash_check',
  'daily_participants_question_order_check',
  'daily_participants_completion_expiry_check',
  'daily_participants_completion_deadline_check',
  'daily_attempts_participant_round_pk',
  'daily_attempts_date_participant_round_unique',
  'daily_attempts_start_request_unique',
  'daily_attempts_terminal_request_unique',
  'daily_attempts_round_number_check',
  'daily_attempts_challenge_round_number_check',
  'daily_attempts_status_check',
  'daily_attempts_opened_bag_count_check',
  'daily_attempts_elapsed_seconds_check',
  'daily_attempts_captured_coins_check',
  'daily_attempts_coin_bag_hits_check',
  'daily_attempts_state_check',
  'daily_opens_participant_round_order_pk',
  'daily_opens_participant_round_bag_unique',
  'daily_opens_request_unique',
  'daily_opens_round_number_check',
  'daily_opens_open_order_check',
  'daily_opens_bag_number_check',
  'daily_opens_remaining_seconds_check',
  'daily_challenge_participants_challenge_date_daily_challenges_challenge_date_fk',
  'daily_attempts_participant_fk',
  'daily_attempts_placement_fk',
  'daily_opens_attempt_fk',
  'daily_participants_ranking_idx',
  'daily_attempts_date_status_idx',
]) {
  assert.match(sql0006, new RegExp(`"${constraint}"`), constraint)
}
assert.match(sql0006, /"id" uuid PRIMARY KEY/)
assert.match(sql0006, /cardinality\([^)]*"question_order"[^)]*\) = 20/)
assert.match(sql0006, /"question_order" @> array\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10,/)
assert.match(sql0006, /"completed_at" is null or "daily_challenge_participants"\."expired_at" is null/)
assert.match(sql0006, /"completed_at" <[\s\S]*"challenge_date"::timestamp at time zone 'UTC'\)[\s\S]*interval '1 day'/)
assert.match(sql0006, /"round_number" between 1 and 20/)
assert.match(sql0006, /'active', 'bombed', 'cashed_out', 'cleared', 'timed_out'/)
assert.match(sql0006, /"elapsed_seconds" between 0 and 60/)
assert.match(sql0006, /"captured_coins" between 0 and 3/)
assert.match(sql0006, /'timed_out'[\s\S]*"elapsed_seconds" = 60[\s\S]*"captured_coins" = 0/)
assert.match(sql0006, /"remaining_seconds_at_tap" between 1 and 60/)
assert.match(sql0006, /FOREIGN KEY \("challenge_date","participant_id"\)/)
assert.match(sql0006, /FOREIGN KEY \("challenge_date","challenge_round_number"\)/)
assert.match(sql0006, /FOREIGN KEY \("challenge_date","participant_id","round_number"\)/)
assert.doesNotMatch(sql0006, /UNIQUE\([^)]*"nickname_key"/)

const allowedAlterTables = new Set([
  'daily_challenge_participants',
  'daily_challenge_round_attempts',
  'daily_challenge_round_opens',
])
for (const match of sql0006.matchAll(/ALTER TABLE "([^"]+)"/g)) {
  assert(allowedAlterTables.has(match[1]!), `unexpected ALTER TABLE: ${match[1]}`)
}
assert.doesNotMatch(sql0006, /group_round_attempts_state_check/)
assert.doesNotMatch(sql0006, /\b(?:group|duel|solo)_[a-z_]+\b/i)
assert.doesNotMatch(sql0006, /DROP\s+(?:TABLE|INDEX|CONSTRAINT)/i)
assert.doesNotMatch(
  sql0006,
  /(?:^|\n)\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO)\b/i,
)

const persistSource = readFileSync(
  join(root, 'server/db/dailyQuestionSet.ts'),
  'utf8',
)
assert.match(persistSource, /on conflict \(challenge_date\) do nothing/)
assert.match(persistSource, /persistOrLoadDailyQuestionSet/)

const apiFiles = readdirSync(join(root, 'api'), { withFileTypes: true })
assert(
  !apiFiles.some(
    (entry) =>
      entry.name === 'daily.ts' ||
      entry.name === 'daily' ||
      entry.name.startsWith('daily'),
  ),
  'no public /api/daily entry must exist yet',
)

const vercel = readFileSync(join(root, 'vercel.json'), 'utf8')
assert.doesNotMatch(vercel, /daily/)

console.log('verify:daily-db OK')
