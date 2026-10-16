/** IndexedDB join-intent schema and fail-closed contract (DB/API free). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DAILY_JOIN_INTENT_DB_NAME,
  DAILY_JOIN_INTENT_STORE_NAME,
  DailyJoinIntentStorageError,
  browserDailyJoinIntentStore,
  validateDailyJoinIntent,
} from '../src/daily/dailyJoinIntentStorage.ts'

const valid = {
  version: 1,
  challengeDate: '2026-10-14',
  joinRequestId: '11111111-1111-4111-8111-111111111111',
  nickname: 'Player',
}

assert.equal(DAILY_JOIN_INTENT_DB_NAME, '3cb-daily-join-intents-v1')
assert.equal(DAILY_JOIN_INTENT_STORE_NAME, 'joinIntents')
assert.deepEqual(validateDailyJoinIntent(valid), valid)
for (const invalid of [
  { ...valid, version: 2 },
  { ...valid, challengeDate: '2026-02-30' },
  { ...valid, joinRequestId: 'not-a-uuid' },
  { ...valid, nickname: '' },
  { ...valid, token: 'must-never-be-stored' },
]) {
  assert.throws(
    () => validateDailyJoinIntent(invalid),
    DailyJoinIntentStorageError,
  )
}

// Node has no browser IndexedDB. Production must report that absence, not
// silently fall back to a racy localStorage-only JOIN.
assert.equal(browserDailyJoinIntentStore(), null)

const source = readFileSync(
  resolve(import.meta.dirname, '../src/daily/dailyJoinIntentStorage.ts'),
  'utf8',
)
assert.match(source, /createObjectStore\(DAILY_JOIN_INTENT_STORE_NAME/)
assert.match(source, /keyPath: 'challengeDate'/)
assert.match(source, /'readwrite'/)
assert.match(source, /store\.get\(proposed\.challengeDate\)/)
assert.match(source, /store\.add\(proposed\)/)
assert.match(source, /transaction\.oncomplete/)
assert.match(source, /request\.onblocked/)
assert.doesNotMatch(source, /token|capability|fetch\(/i)

console.log('verify:daily-join-intent-storage OK')
