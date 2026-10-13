/** UTC DAILY challenge date helpers (no database). */
import assert from 'node:assert/strict'
import {
  utcDailyChallengeDate,
  validateDailyChallengeDate,
} from '../src/daily/dailyChallengeDate'

assert.equal(validateDailyChallengeDate('2026-10-14'), '2026-10-14')
assert.equal(validateDailyChallengeDate('2026-01-01'), '2026-01-01')

for (const invalid of [
  '2026/10/14',
  '26-10-14',
  '2026-10-14T00:00:00Z',
  '2026-02-30',
  '2026-13-01',
  '2026-00-10',
  '',
  null,
  20261014,
]) {
  assert.throws(() => validateDailyChallengeDate(invalid))
}

// UTC midnight boundary: 2026-10-13 23:59:59.999Z still previous day;
// 2026-10-14 00:00:00.000Z is the new challenge date.
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-13T23:59:59.999Z')),
  '2026-10-13',
)
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-14T00:00:00.000Z')),
  '2026-10-14',
)
// Japan 09:00 JST = UTC 00:00 — same switchover.
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-14T08:59:59+09:00')),
  '2026-10-13',
)
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-14T09:00:00+09:00')),
  '2026-10-14',
)

console.log('verify:daily-challenge-date OK')
