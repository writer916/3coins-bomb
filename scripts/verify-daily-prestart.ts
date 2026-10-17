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
import { dailyEntryStateFromParticipant } from '../src/daily/dailyPreStartState.ts'

const root = resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

assert.equal(DAILY_CHALLENGE_ROUNDS, 20)
assert.equal(DAILY_ROUND_LIMIT_SECONDS, 60)

assert.equal(en.modeDailyName, 'DAILY CHALLENGE')
assert.equal(ja.modeDailyName, 'DAILY CHALLENGE')
assert.equal(en.modeSoloName, 'SOLO')
assert.equal(en.modeDuelName, 'DUEL')
assert.equal(en.modeGroupName, 'GROUP')
assert.equal(ja.modeSoloDesc, '3枚のコインが隠された袋を当てる')
assert.equal(en.modeSoloDesc, 'Find the 3 hidden coins')
assert.equal(en.modeDailyDesc, 'Compete for a place in the daily ranking')
assert.equal(ja.modeDailyDesc, '参加者によるランキング形式の勝負')
assert.equal(ja.modeGroupBadge, '最大20人')
assert.equal(en.modeGroupBadge, 'UP TO 20')
assert.equal(en.dailyTimeoutValue, '0 COINS')
assert.equal(ja.dailyTimeoutValue, '0 COINS')
assert.equal(en.dailyStart, 'START')
assert.equal(ja.dailyStart, 'START')
assert.equal(ja.dailyPlayingStatus('あ'), '「あ」として参加中')
assert.equal(ja.dailyCompletedStatus('あ'), '「あ」として参加済み')
assert.equal(ja.dailyContinue, '続ける')
assert.equal(ja.dailyViewResult, '結果を見る')
assert.equal(en.dailyPlayingStatus('Alice'), 'Playing as Alice')
assert.equal(en.dailyCompletedStatus('Alice'), 'Completed as Alice')
assert.equal(en.dailyContinue, 'CONTINUE')
assert.equal(en.dailyViewResult, 'VIEW RESULT')
assert.equal(ja.dailyStatusLoading, '確認中')
assert.equal(en.dailyStatusLoading, 'CHECKING')
assert.equal(dailyEntryStateFromParticipant({ completedAt: null }), 'playing')
assert.equal(
  dailyEntryStateFromParticipant({ completedAt: '2026-10-16T01:00:00.000Z' }),
  'completed',
)
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(ja.cashOut, 'ここで利確')
assert.equal(
  en.dailyIntroRule,
  'You can enter this ranking challenge once every day. There are 20 ROUNDS, each with a 60-second time limit. If you time out, you earn 0 COINS for that ROUND.',
)
assert.equal(
  ja.dailyIntroRule,
  '毎日1回参加できる、ランキング形式のゲームです。20ROUND制で、各ROUNDの制限時間1分。タイムアウトすると、そのROUNDで獲得したコインは0枚になります。',
)
assert.equal(ja.dailyJoinedStatus('あ'), '「あ」として参加済み')
assert.equal(ja.dailyJoinedStatus('桃太郎'), '「桃太郎」として参加済み')
assert.equal(en.dailyJoinedStatus('Alice'), 'Joined as Alice')
assert.doesNotMatch(ja.dailyJoinedStatus('あ'), /」\s+として/)
assert.doesNotMatch(ja.dailyIntroRule, /\n/)

assert.equal(
  en.dailyRankingRule,
  'To appear in the ranking, you must finish 20 ROUNDS during the challenge period, and your final action must reach the server before the period ends.',
)
assert.equal(
  ja.dailyRankingRule,
  'ランキングにあなたの結果を表示するには、開催時間内に20ROUNDを終了し、最終操作をサーバーが受信している必要があります。',
)
assert.equal(en.dailyServerArrivalRule, '')
assert.equal(ja.dailyServerArrivalRule, '')
assert.equal(
  en.dailySameBrowserRule,
  'Play all the way through on the same device and browser.',
)
assert.equal(
  ja.dailySameBrowserRule,
  '参加される場合は、同じ端末の同じブラウザで最後までプレイしてください。',
)
for (const paragraph of [
  en.dailyIntroRule,
  en.dailyRankingRule,
  en.dailySameBrowserRule,
]) assert.doesNotMatch(paragraph, /\n/)
assert.doesNotMatch(ja.dailyRankingRule, /\n/)
assert.doesNotMatch(ja.dailySameBrowserRule, /\n/)
assert.equal(ja.dailyPeriodLabel, '本日の開催時間')
assert.equal(en.dailyPeriodLabel, 'TODAY (JST)')

const tokyo = formatDailyChallengePeriod('2026-10-14', 'Asia/Tokyo')
const denver = formatDailyChallengePeriod('2026-10-14', 'America/Denver')
assert.equal(tokyo.challengeDate, '2026-10-14')
assert.equal(denver.challengeDate, '2026-10-14')
assert.notEqual(tokyo.startsAt, denver.startsAt)
assert.equal(tokyo.startsAt, '2026-10-14 09:00')
assert.equal(tokyo.endsAt, '2026-10-15 09:00')
assert.equal(
  ja.dailyPeriodRange(tokyo.startsAt, tokyo.endsAt),
  '10月14日 9:00 ～ 翌日 9:00',
)
assert.equal(
  en.dailyPeriodRange(tokyo.startsAt, tokyo.endsAt),
  'Oct 14 09:00 – Oct 15 09:00',
)
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
assert.match(modeSelect, /mode-card-heading--group/)
assert.match(modeSelect, /mode-card-group-title-anchor/)
assert.match(modeSelect, /onSelect\('solo'\)/)
assert.match(modeSelect, /onSelect\('duel'\)/)
assert.match(modeSelect, /onSelect\('group'\)/)

const app = read('src/App.tsx')
assert.match(app, /DailyPreStartScreen/)
assert.match(app, /locale=\{locale\}/)
assert.match(app, /DailyPlayScreen/)
assert.match(app, /screen === 'daily'/)
assert.match(app, /mode === 'daily'/)
assert.match(app, /dailyPhase/)

const prestart = read('src/components/DailyPreStartScreen.tsx')
assert.match(prestart, /formatDailyChallengePeriod/)
assert.match(prestart, /readDailyParticipant/)
assert.match(prestart, /createDailyParticipantCoordinator/)
assert.match(prestart, /const startInFlightRef = useRef\(false\)/)
assert.match(prestart, /startInFlightRef\.current/)
assert.match(prestart, /const participantCoordinator = useMemo/)
assert.match(prestart, /mountedRef\.current/)
assert.match(prestart, /createDailyPlayCoordinator/)
assert.match(prestart, /onEnterPlay/)
assert.match(prestart, /onShowResult\(joined\.challengeDate\)/)
assert.match(prestart, /loadOrStart/)
assert.match(prestart, /entryState === 'checking'/)
assert.match(
  prestart,
  /entryState === 'checking'[\s\S]*?\? t\.dailyStatusLoading/,
)
assert.match(
  prestart,
  /entryState === 'checking' \? \([\s\S]*?data-daily-status-placeholder=""/,
)
assert.doesNotMatch(
  prestart,
  /data-daily-status-placeholder=""[\s\S]{0,120}dailyStatusLoading/,
)
assert.match(prestart, /disabled=\{!canPrimaryAction\}/)
assert.match(prestart, /entryState === 'playing'/)
assert.match(prestart, /entryState === 'completed'/)
assert.match(prestart, /entryState === 'status-error'/)
assert.match(prestart, /dailyStatusRetry/)
assert.match(prestart, /dailyRankingRule/)
assert.match(prestart, /dailyIntroRule/)
assert.match(prestart, /dailyServerArrivalRule/)
assert.match(prestart, /dailySameBrowserRule/)
assert.match(prestart, /dailyServerArrivalRule \?/)
assert.match(prestart, /'Asia\/Tokyo'/)
assert.doesNotMatch(prestart, /<br\s*\/?\s*>/i)
assert.doesNotMatch(prestart, /dailyRoundsLabel|dailyTimeLimitLabel|dailyTimeoutLabel/)
assert.doesNotMatch(prestart, /GroupReadyScreen/)
assert.doesNotMatch(prestart, /groupPlayReady|groupPlayStart|duelStartConfirmStart/)
assert.doesNotMatch(prestart, /dailyStartDisabledHint/)
assert.match(prestart, /dailyPeriodRange/)
assert.match(prestart, /dailyNickname/)
assert.match(prestart, /dailyStart/)
assert.match(prestart, /reportDailyStartFailure/)
for (const stage of [
  'participant-join',
  'participant-restore',
  'placements',
  'play',
  'round-start',
] as const) {
  assert.match(prestart, new RegExp(`['"]${stage}['"]`))
}
assert.match(prestart, /import\.meta\.env\.DEV/)
assert.doesNotMatch(prestart, /console\.error\([^\n]*(?:token|Authorization|response)/i)

const css = read('src/App.css')
assert.match(
  css,
  /\.daily-prestart__joined[\s\S]*?min-height:\s*1\.2em[\s\S]*?line-height:\s*1\.2/,
)
assert.match(
  css,
  /\.duel-flow--setup\.daily-prestart \.duel-instruction\s*\{[^}]*display:\s*block;/s,
)
assert.match(
  css,
  /\.duel-flow--setup\.daily-prestart \.duel-instruction\s*\{[^}]*overflow-wrap:\s*break-word;/s,
)
assert.match(
  css,
  /\.duel-flow--setup\.daily-prestart \.daily-prestart__ranking[\s\S]*?text-align:\s*left;/,
)
assert.match(css, /\.mode-card-heading--group\s*\{[^}]*place-items:\s*center;/s)
assert.match(
  css,
  /\.mode-card-group-title-anchor\s*\{[^}]*position:\s*relative;[^}]*display:\s*inline-flex;/s,
)
assert.match(
  css,
  /\.mode-card-heading--group \.mode-badge\s*\{[^}]*position:\s*absolute;[^}]*left:\s*calc\(100% \+ 0\.55rem\);/s,
)
assert.match(
  css,
  /\.mode-card-heading--group \.mode-badge\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*max-content;[^}]*white-space:\s*nowrap;/s,
)
assert.match(css, /\.app--daily-prestart \.field-header\s*\{[^}]*margin-bottom:/s)
assert.match(prestart, /className="daily-prestart__prose"/)
assert.match(
  css,
  /\.daily-prestart__prose\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*center;[^}]*width:\s*100%;[^}]*min-block-size:\s*17\.75rem;/s,
)
assert.doesNotMatch(css, /\.daily-prestart__prose\s*\{[^}]*\bheight\s*:/s)
assert.match(css, /\.daily-prestart__period\s*\{[^}]*display:\s*flex;/s)
assert.match(css, /\.daily-prestart__period\s*\{[^}]*flex-wrap:\s*wrap;/s)
assert.match(css, /\.daily-prestart__period\s*\{[^}]*gap:\s*0\.15rem\s+1\.1rem;/s)
assert.match(css, /\.daily-prestart__period\s*\{[^}]*text-align:\s*left;/s)
assert.match(css, /line-height:\s*1\.68/)
assert.match(css, /padding-bottom:\s*max\([^;]*safe-area-inset-bottom/)

// Existing modes untouched by this screen.
assert.doesNotMatch(prestart, /SoloPlay|handleBagTap/)
assert.doesNotMatch(read('src/components/GroupPlayScreen.tsx'), /dailyPlay|DailyPlay/)
assert.doesNotMatch(read('src/components/DuelPlayScreen.tsx'), /dailyPlay|DailyPlay/)

console.log('verify:daily-prestart OK')
