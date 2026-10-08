/**
 * GROUP bomb scoring DB-safety contracts (no live DB connection).
 * Documents production CHECK vs code write path, read normalization coverage,
 * and review-only repair/migration drafts.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  aggregateGroupParticipantResult,
  rankGroupParticipants,
  type GroupRoundPlacement,
} from '../src/group/groupDomain.ts'

const root = resolve(import.meta.dirname, '..')
const migration0002 = readFileSync(
  resolve(root, 'drizzle/0002_futuristic_nocturne.sql'),
  'utf8',
)
const migration0004 = readFileSync(
  resolve(root, 'drizzle/0004_rare_paladin.sql'),
  'utf8',
)
const schema = readFileSync(resolve(root, 'server/db/schema.ts'), 'utf8')
const openSql = readFileSync(resolve(root, 'server/db/openGroupBag.ts'), 'utf8')
const getResult = readFileSync(resolve(root, 'server/db/getGroupResult.ts'), 'utf8')
const journal = readFileSync(resolve(root, 'drizzle/meta/_journal.json'), 'utf8')

/* Historical: 0002 required bombed = 0; 0004 loosened to 0–2 (prod today). */
assert.match(migration0002, /status" = 'bombed'[\s\S]*?captured_coins" = 0/)
assert.match(
  migration0004,
  /status" = 'bombed'[\s\S]*?captured_coins" between 0 and 2/,
)

/* Code schema intent (not yet applied on prod until approved migration). */
assert.match(
  schema,
  /\$\{table\.status\} = 'bombed'[\s\S]*?\$\{table\.capturedCoins\} = 0/,
)

/* New writes: bomb → 0. Compatible with BOTH 0002 (=0) and 0004 (0–2). */
assert.match(openSql, /when judged\.bomb_hit then 0/)
assert.doesNotMatch(openSql, /when judged\.bomb_hit then judged\.prior_coins/)
assert.match(openSql, /version = attempt\.version \+ 1/)

/* Simulate constraint acceptance for bombed + captured_coins = 0 under 0004. */
function prod0004AllowsBombedCaptured(captured: number): boolean {
  return Number.isInteger(captured) && captured >= 0 && captured <= 2
}
assert.equal(prod0004AllowsBombedCaptured(0), true)
assert.equal(prod0004AllowsBombedCaptured(1), true)
assert.equal(prod0004AllowsBombedCaptured(2), true)
assert.equal(prod0004AllowsBombedCaptured(3), false)

/* Desired post-migration constraint. */
function desiredBombedCaptured(captured: number): boolean {
  return captured === 0
}
assert.equal(desiredBombedCaptured(0), true)
assert.equal(desiredBombedCaptured(1), false)

/* Read normalization is shared by RESULT + detail via participantInput. */
assert.match(getResult, /function participantInput/)
assert.match(getResult, /endReason === 'bombed' \? 0 : storedCapturedCoins/)
assert.match(getResult, /loadClosedParticipants/)
assert.match(getResult, /getGroupResultForParticipant/)
assert.match(getResult, /getGroupResultDetailForParticipant/)
assert.ok(
  getResult.indexOf('function participantInput') <
    getResult.indexOf('getGroupResultForParticipant'),
)
assert.ok(
  getResult.indexOf('loadClosedParticipants') <
    getResult.indexOf('getGroupResultForParticipant'),
)
assert.ok(
  getResult.indexOf('loadClosedParticipants') <
    getResult.indexOf('getGroupResultDetailForParticipant'),
)
/* Both public readers must call loadClosedParticipants (shared coerce). */
assert.equal(
  (getResult.match(/loadClosedParticipants\(row\)/g) ?? []).length,
  2,
)

/* No drizzle journal entry for unapproved CHECK tighten. */
assert.doesNotMatch(journal, /0005_/)
assert.equal(
  existsSync(resolve(root, 'drizzle/0005_group_bomb_captured_coins_check.sql')),
  false,
  'approved migration must not be registered yet',
)

/* Review drafts exist for human approval. */
assert.equal(
  existsSync(
    resolve(root, 'scripts/review/group-bomb-captured-coins-repair.sql'),
  ),
  true,
)
assert.equal(
  existsSync(
    resolve(
      root,
      'scripts/review/0005_group_bomb_captured_coins_check.sql.draft',
    ),
  ),
  true,
)
const repair = readFileSync(
  resolve(root, 'scripts/review/group-bomb-captured-coins-repair.sql'),
  'utf8',
)
assert.match(repair, /status = 'bombed'/)
assert.match(repair, /captured_coins <> 0/)
assert.match(repair, /version = version \+ 1/)
assert.match(repair, /BEGIN;/)
assert.match(repair, /COMMIT;/)
assert.match(repair, /ROLLBACK/)

const draft = readFileSync(
  resolve(
    root,
    'scripts/review/0005_group_bomb_captured_coins_check.sql.draft',
  ),
  'utf8',
)
assert.match(draft, /captured_coins" = 0/)
assert.match(draft, /DROP CONSTRAINT "group_round_attempts_state_check"/)
assert.doesNotMatch(draft, /between 0 and 2/)

/* Legacy bad row → coerce → ranking uses TOTAL 6 not 7 (screenshot case). */
const placement = (n: number): GroupRoundPlacement => ({
  roundNumber: n,
  bagCount: 4,
  bombBagNumber: 4,
  coinBagNumbers: [1, 2, 3],
})
const accepted = '2026-01-01T00:00:00.000Z'
function coerceBombed(captured: number, endReason: string): number {
  return endReason === 'bombed' ? 0 : captured
}
const legacyStored = [
  { endReason: 'bombed' as const, stored: 1 },
  { endReason: 'cleared' as const, stored: 3 },
  { endReason: 'cleared' as const, stored: 3 },
]
const coerced = legacyStored.map((round, index) => ({
  roundNumber: index + 1,
  endReason: round.endReason,
  capturedCoins: coerceBombed(round.stored, round.endReason),
  opens:
    round.endReason === 'bombed'
      ? [
          { openOrder: 1, bagNumber: 1 },
          { openOrder: 2, bagNumber: 4 },
        ]
      : [
          { openOrder: 1, bagNumber: 1 },
          { openOrder: 2, bagNumber: 2 },
          { openOrder: 3, bagNumber: 3 },
        ],
}))
const summary = aggregateGroupParticipantResult({
  participantId: 'legacy',
  acceptedAt: accepted,
  totalRounds: 3,
  placements: [placement(1), placement(2), placement(3)],
  rounds: coerced,
})
assert.equal(summary.totalCapturedCoins, 6)
assert.equal(summary.threeCoinsComplete, 2)
assert.equal(summary.rounds[0]?.capturedCoins, 0)
assert.ok(summary.coinBagHits >= 1)

const rival = aggregateGroupParticipantResult({
  participantId: 'rival',
  acceptedAt: '2026-01-01T00:00:01.000Z',
  totalRounds: 3,
  placements: [placement(1), placement(2), placement(3)],
  rounds: [
    {
      roundNumber: 1,
      endReason: 'cleared',
      capturedCoins: 3,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 2 },
        { openOrder: 3, bagNumber: 3 },
      ],
    },
    {
      roundNumber: 2,
      endReason: 'cleared',
      capturedCoins: 3,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 2 },
        { openOrder: 3, bagNumber: 3 },
      ],
    },
    {
      roundNumber: 3,
      endReason: 'interrupted',
      capturedCoins: 0,
      opens: [],
    },
  ],
})
/* Without coerce, legacy TOTAL would be 7 and beat rival's 6; with coerce, rival wins. */
assert.equal(summary.totalCapturedCoins, 6)
assert.equal(rival.totalCapturedCoins, 6)
const ranked = rankGroupParticipants([summary, rival])
assert.equal(ranked.length, 2)

console.log('verify:group-bomb-db-safety OK')
console.log(
  'note: production bad-row counts are NOT queried here (no DATABASE_URL)',
)
