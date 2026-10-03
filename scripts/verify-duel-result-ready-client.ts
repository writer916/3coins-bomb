/**
 * Post-play RESULT flow: waiting poll → result-ready → explicit reveal.
 * Source + pure presentation checks (no PLAY/FX changes).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveDuelResultPresentation } from '../src/duel/duelResultPresentation'
import type { DuelFinalResult } from '../src/duel/duelPlayClient'

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
  viewerRole: 'B',
  totalRounds: 1,
  winner: 'draw',
  participants: {
    A: {
      role: 'A',
      totalCapturedCoins: 2,
      threeCoinsComplete: 0,
      bombsHit: 0,
      coinBagHits: 1,
      totalOpens: 2,
      hitRate: { numerator: 1, denominator: 2 },
      rounds: [
        {
          roundNumber: 1,
          endReason: 'cashed_out',
          capturedCoins: 2,
          openedBagCount: 2,
        },
      ],
    },
    B: {
      role: 'B',
      totalCapturedCoins: 2,
      threeCoinsComplete: 0,
      bombsHit: 0,
      coinBagHits: 1,
      totalOpens: 2,
      hitRate: { numerator: 1, denominator: 2 },
      rounds: [
        {
          roundNumber: 1,
          endReason: 'cashed_out',
          capturedCoins: 2,
          openedBagCount: 2,
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

const [
  resultScreen,
  playScreen,
  presentation,
  types,
  en,
  ja,
  invitePanel,
] = await Promise.all([
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/duel/duelResultPresentation.ts', 'utf8'),
  readFile('src/i18n/types.ts', 'utf8'),
  readFile('src/i18n/en.ts', 'utf8'),
  readFile('src/i18n/ja.ts', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
])

assert.match(resultScreen, /DUEL_RESULT_POLL_INTERVAL_MS = 5_000/)
assert.match(resultScreen, /setInterval/)
assert.match(resultScreen, /visibilitychange/)
assert.match(resultScreen, /visibilityState === 'visible'/)
assert.match(resultScreen, /clearInterval/)
assert.match(resultScreen, /inFlight/)
assert.match(resultScreen, /keep waiting/)
assert.match(resultScreen, /resolveDuelResultPresentation/)
assert.match(resultScreen, /t\.duelViewResult/)
assert.match(resultScreen, /duel-final--waiting/)
assert.match(resultScreen, /duel-final--ready/)
assert.match(resultScreen, /setRevealed\(true\)/)
assert.doesNotMatch(resultScreen, /t\.duelCheckResult/)
assert.equal([...resultScreen.matchAll(/setInterval\s*\(/g)].length, 1)
assert.match(resultScreen, /document\.addEventListener\('visibilitychange'/)
assert.match(resultScreen, /removeEventListener\('visibilitychange'/)

// Waiting UI must not leak completed stats
const waitingBlock = resultScreen.slice(
  resultScreen.indexOf("phase === 'waiting-for-opponent-complete'"),
  resultScreen.indexOf("phase === 'result-ready'"),
)
assert.match(waitingBlock, /t\.duelWaitingTitle/)
assert.match(waitingBlock, /t\.duelWaitingBody/)
assert.doesNotMatch(waitingBlock, /winner|totalCapturedCoins|duelWin|duelLose/)

const readyStart = resultScreen.indexOf("phase === 'result-ready'")
assert.ok(readyStart > 0)
const readyBlock = resultScreen.slice(readyStart, readyStart + 350)
assert.match(readyBlock, /t\.duelViewResult/)
assert.doesNotMatch(readyBlock, /winner|totalCapturedCoins|duelWin|CompletedResult/)

assert.match(presentation, /duelResumeCompletionFromResult/)
assert.match(presentation, /classifyDuelResumeState/)
assert.match(presentation, /result-ready/)
assert.match(presentation, /waiting-for-opponent-complete/)

assert.match(playScreen, /initialResult=\{finalResult\}/)
assert.match(playScreen, /fetchResult=\{\(\) => coordinator\.getFinalResult\(matchId\)\}/)
assert.match(playScreen, /matchId=\{matchId\}/)
assert.match(
  playScreen,
  /initialRevealed=\{finalResult\.status === 'completed'\}/,
)
assert.doesNotMatch(playScreen, /onCheck/)

/* Same-session PLAY RESULT + completed → start revealed; waiting stays false. */
assert.match(resultScreen, /initialRevealed\?: boolean/)
assert.match(resultScreen, /initialRevealed = false/)
assert.match(
  resultScreen,
  /initialRevealed === true && initialResult\.status === 'completed'/,
)
assert.equal(
  resolveDuelResultPresentation(MATCH_ID, completed, true),
  'result',
)
assert.equal(
  resolveDuelResultPresentation(MATCH_ID, waiting, true),
  'waiting-for-opponent-complete',
)

assert.match(types, /duelViewResult/)
assert.match(ja, /duelViewResult: '結果を見る'/)
assert.match(en, /duelViewResult:/)

// InvitePanel polling must remain local (no shared helper refactor)
assert.match(invitePanel, /DUEL_READY_POLL_INTERVAL_MS = 5_000/)
assert.doesNotMatch(invitePanel, /attachDuelMatchVisibilityPoll|duelResultPresentation/)

/* Bootstrap resume must not force initialRevealed. */
const bootstrap = await readFile(
  'src/components/DuelClaimBootstrap.tsx',
  'utf8',
)
assert.match(bootstrap, /DuelResultScreen/)
assert.doesNotMatch(bootstrap, /initialRevealed/)

assert.doesNotMatch(resultScreen, /console\.|\.\.\/server\/|server\/db/)
assert.doesNotMatch(presentation, /console\.|setInterval|localStorage/)

console.log('verify-duel-result-ready-client: all checks passed')
