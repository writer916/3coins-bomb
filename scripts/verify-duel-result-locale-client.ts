/**
 * DUEL result locale geometry slots (completion waiting + RESULT titles).
 * Layout-only; copy / polling / reveal / digit fonts stay unchanged.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [appCss, resultScreen] = await Promise.all([
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
])

/* ——— Copy unchanged ——— */
assert.equal(ja.duelWaitingTitle, 'WAITING FOR OPPONENT')
assert.equal(en.duelWaitingTitle, 'WAITING FOR OPPONENT')
assert.equal(ja.duelWaitingBody, '相手のプレイ終了を待っています。')
assert.equal(en.duelWaitingBody, 'Waiting for your opponent to finish playing.')
assert.equal(ja.duelViewResult, '結果を見る')
assert.equal(en.duelViewResult, 'View result')
assert.equal(ja.duelYou, 'あなた')
assert.equal(en.duelYou, 'YOU')
assert.equal(ja.duelOpponent, '相手')
assert.equal(en.duelOpponent, 'OPPONENT')
assert.equal(ja.duelResult, 'RESULT')
assert.equal(en.duelResult, 'RESULT')

/* ——— P1: waiting slots (scoped; center layout kept) ——— */
assert.match(appCss, /\.duel-final--waiting\s+\.duel-final-kicker\s*{[^}]*min-height:/s)
assert.match(appCss, /\.duel-final--waiting\s+\.duel-final-copy\s*{[^}]*min-height:/s)
assert.match(
  appCss,
  /\.duel-final--waiting\s+\.duel-final-copy\s*{[^}]*min-height:\s*calc\(1em\s*\*\s*1\.5\s*\*\s*2\)/s,
)
assert.match(appCss, /\.duel-final\s*{[^}]*justify-content:\s*center/s)
assert.doesNotMatch(appCss, /\.duel-final--waiting\s*{[^}]*justify-content:\s*flex-start/s)

/* ——— P2: PlayerCard title slot; Georgia kept ——— */
assert.match(
  appCss,
  /\.duel-final-player\s+h3\s*{[^}]*min-height:\s*1\.6rem/s,
)
assert.match(
  appCss,
  /\.duel-final-player\s+h3\s*{[^}]*font-family:\s*Georgia/s,
)
assert.doesNotMatch(
  appCss,
  /\.duel-final-player\s+h3\s*{[^}]*font-family:\s*system-ui/s,
)

/* ——— Digit fonts unchanged ——— */
assert.match(
  appCss,
  /\.duel-final-stat\s+strong\s*{[^}]*font-family:\s*[\s\S]*?system-ui/s,
)
assert.match(
  appCss,
  /\.duel-final-stat\s+strong\s*{[^}]*font-variant-numeric:\s*tabular-nums/s,
)

/* ——— Behaviour contracts ——— */
assert.match(resultScreen, /DUEL_RESULT_POLL_INTERVAL_MS = 5_000/)
assert.match(resultScreen, /visibilitychange/)
assert.match(resultScreen, /t\.duelWaitingTitle/)
assert.match(resultScreen, /t\.duelWaitingBody/)
assert.match(resultScreen, /t\.duelViewResult/)
assert.match(resultScreen, /t\.duelYou/)
assert.match(resultScreen, /t\.duelOpponent/)
assert.match(
  resultScreen,
  /initialRevealed === true && initialResult\.status === 'completed'/,
)
assert.doesNotMatch(resultScreen, /duelReturnToTop|onGoTop/)
assert.doesNotMatch(resultScreen, /REMATCH|rematch/)

console.log('verify-duel-result-locale-client: all checks passed')
