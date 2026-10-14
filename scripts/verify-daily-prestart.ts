/** DAILY pre-start UI wiring (no network / no ROUND start). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import {
  DAILY_ROUND_LIMIT_SECONDS,
  formatDailyChallengePeriod,
} from '../src/daily/dailyTime.ts'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

assert.equal(DAILY_CHALLENGE_ROUNDS, 20)
assert.equal(DAILY_ROUND_LIMIT_SECONDS, 60)

assert.equal(en.modeDailyName, 'DAILY')
assert.equal(ja.modeDailyName, 'DAILY')
assert.equal(en.modeSoloName, 'SOLO')
assert.equal(en.modeDuelName, 'DUEL')
assert.equal(en.modeGroupName, 'GROUP')
assert.equal(ja.modeSoloDesc, '3枚のコインが隠された袋を当てる')
assert.equal(en.modeSoloDesc, 'Find the 3 hidden coins')
assert.match(en.modeDailyDesc, /20/)
assert.match(ja.modeDailyDesc, /20/)
assert.equal(en.dailyTimeoutValue, '0 COINS')
assert.equal(ja.dailyTimeoutValue, '0 COINS')
assert.equal(en.dailyStart, 'START')
assert.equal(ja.dailyStart, 'START')
assert.ok(en.dailyStartDisabledHint.length > 0)
assert.ok(ja.dailyStartDisabledHint.length > 0)

// Device-local schedule (not hard-coded JST): same UTC day, different zones.
const tokyo = formatDailyChallengePeriod('2026-10-14', 'Asia/Tokyo')
const denver = formatDailyChallengePeriod('2026-10-14', 'America/Denver')
assert.equal(tokyo.challengeDate, '2026-10-14')
assert.equal(denver.challengeDate, '2026-10-14')
assert.notEqual(tokyo.startsAt, denver.startsAt)
assert.equal(tokyo.startsAt, '2026-10-14 09:00')
assert.equal(tokyo.endsAt, '2026-10-15 09:00')
// October is MDT (UTC-6) in Denver, not MST.
assert.equal(denver.startsAt, '2026-10-13 18:00')
assert.equal(denver.endsAt, '2026-10-14 18:00')

// DST: US spring forward — local offset changes across the UTC day boundary.
const beforeDst = formatDailyChallengePeriod('2026-03-07', 'America/New_York')
const afterDst = formatDailyChallengePeriod('2026-03-08', 'America/New_York')
assert.equal(beforeDst.startsAt, '2026-03-06 19:00')
assert.equal(beforeDst.endsAt, '2026-03-07 19:00')
assert.equal(afterDst.startsAt, '2026-03-07 19:00')
assert.equal(afterDst.endsAt, '2026-03-08 20:00')

const modeSelect = read('src/components/ModeSelect.tsx')
assert.match(modeSelect, /PlayMode = 'solo' \| 'duel' \| 'group' \| 'daily'/)
assert.match(modeSelect, /onSelect\('daily'\)/)
assert.match(modeSelect, /t\.modeDailyName/)
assert.match(modeSelect, /onSelect\('solo'\)/)
assert.match(modeSelect, /onSelect\('duel'\)/)
assert.match(modeSelect, /onSelect\('group'\)/)

const app = read('src/App.tsx')
assert.match(app, /DailyPreStartScreen/)
assert.match(app, /screen === 'daily'/)
assert.match(app, /mode === 'daily'/)
assert.doesNotMatch(app, /createDailyParticipantCoordinator/)

const prestart = read('src/components/DailyPreStartScreen.tsx')
assert.match(prestart, /DAILY_CHALLENGE_ROUNDS/)
assert.match(prestart, /DAILY_ROUND_LIMIT_SECONDS/)
assert.match(prestart, /formatDailyChallengePeriod/)
assert.match(prestart, /readDailyParticipant/)
assert.match(prestart, /disabled/)
assert.match(prestart, /dailyStartDisabledHint/)
assert.doesNotMatch(prestart, /createDailyParticipantCoordinator/)
assert.doesNotMatch(prestart, /postDailyJoin/)
assert.doesNotMatch(prestart, /fetchDailyParticipant/)
assert.doesNotMatch(prestart, /GroupReadyScreen/)
assert.doesNotMatch(prestart, /groupPlayReady|groupPlayStart|duelStartConfirmStart/)
assert.doesNotMatch(prestart, /\/api\/daily/)

assert.match(read('src/App.css'), /\.daily-prestart/)
assert.match(
  en.dailyPeriodRange('2026-10-14 09:00', '2026-10-15 09:00'),
  /2026-10-14 09:00/,
)
assert.equal(en.dailyRoundsValue(20), '20')
assert.equal(en.dailyTimeLimitValue(60), '60 sec / ROUND')
assert.equal(ja.dailyTimeLimitValue(60), '60秒 / ROUND')

console.log('verify:daily-prestart OK')
