/** DAILY pre-start UI wiring (JOIN + START → play handoff). */
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
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(ja.cashOut, 'ここで利確')

// Existing EN ranking copy must stay; server-arrival is a separate key.
assert.equal(en.dailyRankingRule, 'Finish all 20 ROUNDS to enter the ranking.')
assert.equal(
  ja.dailyRankingRule,
  'ランキングに参加するには、開催時間内に全20ROUNDを終了し、最終操作がサーバーに到着している必要があります。',
)
assert.equal(
  en.dailyServerArrivalRule,
  'Your final action must reach the server before the challenge period ends.',
)
assert.equal(ja.dailyServerArrivalRule, '')
assert.match(en.dailyServerArrivalRule, /server/i)
assert.match(en.dailyServerArrivalRule, /before the challenge period ends/i)
assert.equal(
  en.dailySameBrowserRule,
  'Play through to the end on the same device and browser you started with.',
)
assert.equal(
  ja.dailySameBrowserRule,
  'ゲームは開始した端末の同じブラウザで最後までプレイしてください。',
)

const tokyo = formatDailyChallengePeriod('2026-10-14', 'Asia/Tokyo')
const denver = formatDailyChallengePeriod('2026-10-14', 'America/Denver')
assert.equal(tokyo.challengeDate, '2026-10-14')
assert.equal(denver.challengeDate, '2026-10-14')
assert.notEqual(tokyo.startsAt, denver.startsAt)
assert.equal(tokyo.startsAt, '2026-10-14 09:00')
assert.equal(tokyo.endsAt, '2026-10-15 09:00')
assert.equal(denver.startsAt, '2026-10-13 18:00')
assert.equal(denver.endsAt, '2026-10-14 18:00')

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
assert.match(app, /DailyPlayScreen/)
assert.match(app, /screen === 'daily'/)
assert.match(app, /mode === 'daily'/)
assert.match(app, /dailyPhase/)

const prestart = read('src/components/DailyPreStartScreen.tsx')
assert.match(prestart, /DAILY_CHALLENGE_ROUNDS/)
assert.match(prestart, /DAILY_ROUND_LIMIT_SECONDS/)
assert.match(prestart, /formatDailyChallengePeriod/)
assert.match(prestart, /readDailyParticipant/)
assert.match(prestart, /createDailyParticipantCoordinator/)
assert.match(prestart, /createDailyPlayCoordinator/)
assert.match(prestart, /onEnterPlay/)
assert.match(prestart, /loadOrStart/)
assert.match(prestart, /dailyRankingRule/)
assert.match(prestart, /dailyServerArrivalRule/)
assert.match(prestart, /dailySameBrowserRule/)
assert.match(prestart, /dailyServerArrivalRule \?/)
assert.doesNotMatch(prestart, /GroupReadyScreen/)
assert.doesNotMatch(prestart, /groupPlayReady|groupPlayStart|duelStartConfirmStart/)
assert.doesNotMatch(prestart, /dailyStartDisabledHint/)
assert.match(prestart, /dailyPeriodRange/)
assert.match(prestart, /dailyNickname/)
assert.match(prestart, /dailyStart/)

// Existing modes untouched by this screen.
assert.doesNotMatch(prestart, /SoloPlay|handleBagTap/)
assert.doesNotMatch(read('src/components/GroupPlayScreen.tsx'), /dailyPlay|DailyPlay/)
assert.doesNotMatch(read('src/components/DuelPlayScreen.tsx'), /dailyPlay|DailyPlay/)

console.log('verify:daily-prestart OK')
