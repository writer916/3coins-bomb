/** DAILY challenge schema + migration checks (no database connection). */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  dailyChallengePlacements,
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

const migrationDir = join(root, 'drizzle')
const migrations = readdirSync(migrationDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
const latest = migrations[migrations.length - 1]!
assert.match(latest, /^0005_/)
const sql = readFileSync(join(migrationDir, latest), 'utf8')
assert.match(sql, /CREATE TABLE "daily_challenges"/)
assert.match(sql, /CREATE TABLE "daily_challenge_placements"/)
assert.match(sql, /"challenge_date" date PRIMARY KEY NOT NULL/)
assert.match(sql, /daily_challenge_placements_date_round_pk/)
assert.doesNotMatch(sql, /group_round_attempts/)
assert.doesNotMatch(sql, /duel_/)

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
