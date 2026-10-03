/**
 * DUEL completion-flow UX: waiting / result-ready shell + final RESULT TOP.
 * Does not change reveal/resume/polling contracts.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveDuelResultPresentation } from '../src/duel/duelResultPresentation'
import type { DuelFinalResult } from '../src/duel/duelPlayClient'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'

const waiting: DuelFinalResult = {
  matchId: MATCH_ID,
  status: 'waiting',
  selfCompleted: true,
  opponentCompleted: false,
}

const completed: DuelFinalResult = {
  matchId: MATCH_ID,
  status: 'completed',
  viewerRole: 'A',
  totalRounds: 1,
  winner: 'A',
  participants: {
    A: {
      role: 'A',
      totalCapturedCoins: 3,
      threeCoinsComplete: 1,
      bombsHit: 0,
      coinBagHits: 1,
      totalOpens: 1,
      hitRate: { numerator: 1, denominator: 1 },
      rounds: [
        {
          roundNumber: 1,
          endReason: 'cleared',
          capturedCoins: 3,
          openedBagCount: 1,
        },
      ],
    },
    B: {
      role: 'B',
      totalCapturedCoins: 0,
      threeCoinsComplete: 0,
      bombsHit: 1,
      coinBagHits: 0,
      totalOpens: 1,
      hitRate: { numerator: 0, denominator: 1 },
      rounds: [
        {
          roundNumber: 1,
          endReason: 'bombed',
          capturedCoins: 0,
          openedBagCount: 1,
        },
      ],
    },
  },
}

assert.equal(
  resolveDuelResultPresentation(MATCH_ID, waiting, false),
  'waiting-for-opponent-complete',
)
assert.equal(
  resolveDuelResultPresentation(MATCH_ID, completed, false),
  'result-ready',
)
assert.equal(
  resolveDuelResultPresentation(MATCH_ID, completed, true),
  'result',
)

assert.equal(ja.duelWaitingTitle, 'プレイが完了しました')
assert.equal(ja.duelWaitingBody, '相手のプレイ終了を待っています。')
assert.equal(ja.duelViewResult, '結果を見る')
assert.equal(ja.duelReturnToTop, 'トップへ戻る')
assert.equal(en.duelWaitingTitle, 'PLAY COMPLETE')
assert.equal(en.duelWaitingBody, 'WAITING FOR OPPONENT TO FINISH')
assert.equal(en.duelViewResult, 'VIEW RESULT')
assert.equal(en.duelReturnToTop, 'BACK TO TOP')

const [
  resultScreen,
  playScreen,
  bootstrap,
  flow,
  invitePanel,
] = await Promise.all([
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelClaimBootstrap.tsx', 'utf8'),
  readFile('src/components/DuelFlow.tsx', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
])

assert.match(resultScreen, /function CompletionShell/)
assert.match(resultScreen, /mode === 'waiting'/)
assert.match(resultScreen, /mode="ready"/)
assert.match(resultScreen, /mode="waiting"/)
assert.match(resultScreen, /duel-final--waiting/)
assert.match(resultScreen, /duel-final--ready/)
assert.match(resultScreen, /duel-final-completion-slot/)
assert.match(resultScreen, /duel-final-view/)
assert.match(resultScreen, /DUEL_RESULT_POLL_INTERVAL_MS = 5_000/)
assert.match(resultScreen, /visibilitychange/)
assert.match(
  resultScreen,
  /initialRevealed === true && initialResult\.status === 'completed'/,
)

/* No TOP on completion shell. */
const shell = resultScreen.slice(
  resultScreen.indexOf('function CompletionShell'),
  resultScreen.indexOf('export function DuelResultScreen'),
)
assert.doesNotMatch(shell, /duelReturnToTop|onGoTop|duel-final-return/)

/* Final RESULT has TOP exit. */
assert.match(resultScreen, /duel-final-return/)
assert.match(resultScreen, /t\.duelReturnToTop/)
assert.match(resultScreen, /onGoTop\?: \(\) => void/)

/* Direct RESULT + resume wiring preserved. */
assert.match(
  playScreen,
  /initialRevealed=\{finalResult\.status === 'completed'\}/,
)
assert.match(playScreen, /onGoTop=\{onGoTop\}/)
assert.match(bootstrap, /onGoTop=\{onGoTop\}/)
assert.doesNotMatch(
  bootstrap.slice(
    bootstrap.indexOf('<DuelResultScreen'),
    bootstrap.indexOf('<DuelResultScreen') + 280,
  ),
  /initialRevealed/,
)
assert.match(flow, /DuelPlayScreen[^>]*onGoTop=\{onGoTop\}/s)
assert.match(invitePanel, /DuelPlayScreen[^>]*onGoTop=\{onGoTop\}/s)

/* Forbidden post-RESULT CTAs for this eng. */
assert.doesNotMatch(resultScreen, /REMATCH|rematch|もう一戦|別の相手|ホーム画面/)

console.log('verify-duel-completion-flow-client: all checks passed')
