import assert from 'node:assert/strict'
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
          openedBagCount: 2,
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
  resolveDuelResultPresentation(MATCH_ID, waiting, true),
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

const waitingB: DuelFinalResult = {
  ...waiting,
  matchId: MATCH_ID,
}
assert.equal(
  resolveDuelResultPresentation(MATCH_ID, waitingB, false),
  'waiting-for-opponent-complete',
)

console.log('verify-duel-result-presentation: all checks passed')
