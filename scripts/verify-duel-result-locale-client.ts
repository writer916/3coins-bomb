/**
 * DUEL result locale geometry + completion-flow copy contracts.
 * Waiting/ready share completion shell slots; final RESULT keeps PlayerCard slots.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [appCss, resultScreen] = await Promise.all([
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
])

/* ——— Completion-flow copy ——— */
assert.equal(ja.duelWaitingTitle, 'プレイが完了しました')
assert.equal(en.duelWaitingTitle, 'PLAY COMPLETE')
assert.equal(ja.duelWaitingBody, '相手のプレイ終了を待っています。')
assert.equal(en.duelWaitingBody, 'WAITING FOR OPPONENT TO FINISH')
assert.equal(ja.duelViewResult, '結果を見る')
assert.equal(en.duelViewResult, 'VIEW RESULT')
assert.equal(ja.duelReturnToTop, 'トップへ戻る')
assert.equal(en.duelReturnToTop, 'BACK TO TOP')
assert.equal(ja.duelAddToHomeScreen, 'ホーム画面に追加')
assert.equal(en.duelAddToHomeScreen, 'ADD TO HOME SCREEN')
assert.equal(ja.duelYou, 'あなた')
assert.equal(en.duelYou, 'YOU')
assert.equal(ja.duelOpponent, '相手')
assert.equal(en.duelOpponent, 'OPPONENT')
assert.equal(ja.duelResult, 'RESULT')
assert.equal(en.duelResult, 'RESULT')

/* ——— Shared completion shell slots (waiting + ready) ——— */
assert.match(
  appCss,
  /\.duel-final--waiting\s+\.duel-final-kicker\s*,\s*\.duel-final--ready\s+\.duel-final-kicker\s*{[^}]*min-height:\s*1\.65rem/s,
)
assert.match(appCss, /\.duel-final-completion-slot\s*{[^}]*min-height:/s)
assert.match(
  appCss,
  /\.duel-final-completion-slot\s*{[^}]*min-height:\s*calc\(1em\s*\*\s*1\.5\s*\*\s*2\)/s,
)
assert.match(appCss, /\.duel-final-view\s*{[^}]*width:\s*11\.5rem/s)
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
assert.match(resultScreen, /CompletionShell/)
assert.match(resultScreen, /t\.duelWaitingTitle/)
assert.match(resultScreen, /t\.duelWaitingBody/)
assert.match(resultScreen, /t\.duelViewResult/)
assert.match(resultScreen, /t\.duelYou/)
assert.match(resultScreen, /t\.duelOpponent/)
assert.match(resultScreen, /t\.duelReturnToTop/)
assert.match(resultScreen, /onGoTop/)
assert.match(resultScreen, /duel-final-return/)
assert.match(
  resultScreen,
  /initialRevealed === true && initialResult\.status === 'completed'/,
)
assert.doesNotMatch(resultScreen, /REMATCH|rematch/)

/* Waiting / ready must not render TOP; only CompletedResult may. */
const completionShell = resultScreen.slice(
  resultScreen.indexOf('function CompletionShell'),
  resultScreen.indexOf('export function DuelResultScreen'),
)
assert.match(completionShell, /duelWaitingTitle/)
assert.match(completionShell, /duelViewResult/)
assert.doesNotMatch(completionShell, /duelReturnToTop|onGoTop|duel-final-return/)

const completedBlock = resultScreen.slice(
  resultScreen.indexOf('function CompletedResult'),
  resultScreen.indexOf('function CompletionShell'),
)
assert.match(completedBlock, /duelReturnToTop/)
assert.match(completedBlock, /onGoTop/)
assert.match(completedBlock, /duelAddToHomeScreen/)
assert.match(completedBlock, /duel-final-actions/)
assert.ok(
  completedBlock.indexOf('duelReturnToTop') < completedBlock.indexOf('duelAddToHomeScreen'),
  'TOP above ADD TO HOME SCREEN',
)
assert.doesNotMatch(completionShell, /duelAddToHomeScreen|duel-final-home-install/)

console.log('verify-duel-result-locale-client: all checks passed')
