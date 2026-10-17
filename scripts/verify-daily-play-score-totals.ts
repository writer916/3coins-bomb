/** Pure contracts for DAILY play cumulative score helpers (no network). */
import assert from 'node:assert/strict'
import {
  applyConfirmedCashOutToTotals,
  applyConfirmedOpenResultToTotals,
  applyConfirmedTerminalToTotals,
  emptyDailyPlayScoreTotals,
  hydrateDailyPlayScoreTotals,
  mergeServerPlayTotals,
  totalsFromServerPlayState,
} from '../src/daily/dailyPlayScoreTotals.ts'
import type { DailyPlayTerminalAttempt } from '../src/daily/dailyPlayClient.ts'

const date = '2026-10-18'

function terminal(
  partial: Partial<DailyPlayTerminalAttempt> &
    Pick<DailyPlayTerminalAttempt, 'roundNumber' | 'capturedCoins' | 'endReason'>,
): DailyPlayTerminalAttempt {
  return {
    bagCount: 3,
    endedAt: '2026-10-18T00:00:00.000Z',
    elapsedSeconds: 10,
    openedBagCount: 1,
    coinBagHits: 1,
    opens: [],
    ...partial,
  }
}

let totals = {
  ...emptyDailyPlayScoreTotals(date),
  ready: true,
}
totals = applyConfirmedTerminalToTotals(
  totals,
  terminal({ roundNumber: 1, capturedCoins: 2, endReason: 'cashed_out' }),
)
assert.equal(totals.totalCoins, 2)
assert.equal(totals.threeCoinsComplete, 0)

totals = applyConfirmedOpenResultToTotals(totals, {
  roundNumber: 2,
  capturedCoins: 3,
  endReason: 'cleared',
  roundEnded: true,
})
assert.equal(totals.totalCoins, 5)
assert.equal(totals.threeCoinsComplete, 1)

totals = applyConfirmedTerminalToTotals(
  totals,
  terminal({ roundNumber: 3, capturedCoins: 0, endReason: 'bombed' }),
)
totals = applyConfirmedTerminalToTotals(
  totals,
  terminal({ roundNumber: 4, capturedCoins: 0, endReason: 'timed_out' }),
)
assert.equal(totals.totalCoins, 5)
assert.equal(totals.threeCoinsComplete, 1)

// Mid-round open must not change totals.
const mid = applyConfirmedOpenResultToTotals(totals, {
  roundNumber: 5,
  capturedCoins: 0,
  endReason: null,
  roundEnded: false,
})
assert.equal(mid.totalCoins, 5)

totals = applyConfirmedCashOutToTotals(totals, {
  roundNumber: 5,
  capturedCoins: 1,
})
assert.equal(totals.totalCoins, 6)

// Duplicate / skip ignored.
assert.equal(
  applyConfirmedTerminalToTotals(
    totals,
    terminal({ roundNumber: 5, capturedCoins: 3, endReason: 'cleared' }),
  ).totalCoins,
  6,
)
assert.equal(
  applyConfirmedTerminalToTotals(
    totals,
    terminal({ roundNumber: 7, capturedCoins: 3, endReason: 'cleared' }),
  ).appliedRoundNumber,
  5,
)

const server = totalsFromServerPlayState({
  challengeDate: date,
  completedRounds: 5,
  totalCoins: 6,
  threeCoinsComplete: 1,
})
assert.deepEqual(server, {
  challengeDate: date,
  appliedRoundNumber: 5,
  totalCoins: 6,
  threeCoinsComplete: 1,
  ready: true,
})

// Local ahead of stale play DTO is kept.
const ahead = applyConfirmedTerminalToTotals(
  server,
  terminal({ roundNumber: 6, capturedCoins: 2, endReason: 'cashed_out' }),
)
const merged = mergeServerPlayTotals(ahead, {
  challengeDate: date,
  completedRounds: 5,
  totalCoins: 6,
  threeCoinsComplete: 1,
})
assert.equal(merged.appliedRoundNumber, 6)
assert.equal(merged.totalCoins, 8)

const hydrated = hydrateDailyPlayScoreTotals({
  play: {
    challengeDate: date,
    completedRounds: 4,
    totalCoins: 5,
    threeCoinsComplete: 1,
    latestTerminalAttempt: terminal({
      roundNumber: 4,
      capturedCoins: 0,
      endReason: 'timed_out',
    }),
  },
  storage: null,
})
assert.equal(hydrated.totalCoins, 5)
assert.equal(hydrated.ready, true)

console.log('verify:daily-play-score-totals OK')
