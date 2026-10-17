/** DAILY normal terminal ROUND reload restoration checks (no DB/network). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createDailyPlayCoordinator,
  parseDailyPlayState,
  type DailyRoundEndReason,
} from '../src/daily/dailyPlayClient.ts'

const date = '2099-09-10'
const iso = '2099-09-10T12:00:20.000Z'

function dto(endReason: DailyRoundEndReason) {
  const capturedCoins =
    endReason === 'cleared' ? 3 : endReason === 'cashed_out' ? 2 : 0
  // Aggregates for the single completed ROUND must match its terminal result.
  const totalCoins = capturedCoins
  const threeCoinsComplete = endReason === 'cleared' ? 1 : 0
  const elapsedSeconds = endReason === 'timed_out' ? 60 : 20
  const opens =
    endReason === 'timed_out'
      ? []
      : [
          {
            openOrder: 1,
            bagNumber: endReason === 'bombed' ? 5 : 1,
            remainingSecondsAtTap: 40,
            openedAt: iso,
            outcome: endReason === 'bombed' ? 'bomb' : 'coins',
            coinsFound: endReason === 'bombed' ? 0 : capturedCoins,
          },
        ]
  return {
    challengeDate: date,
    serverNow: iso,
    challengeEndsAt: '2099-09-11T00:00:00.000Z',
    completedRounds: 1,
    totalCoins,
    threeCoinsComplete,
    nextRoundNumber: 2,
    activeAttempt: null,
    latestTerminalAttempt: {
      roundNumber: 1,
      bagCount: 5,
      endReason,
      endedAt: iso,
      elapsedSeconds,
      capturedCoins,
      openedBagCount: opens.length,
      coinBagHits: endReason === 'bombed' || endReason === 'timed_out' ? 0 : 1,
      opens,
    },
    completedAt: null,
    expiredAt: null,
  }
}

for (const reason of [
  'bombed',
  'cashed_out',
  'cleared',
  'timed_out',
] as const) {
  const body = dto(reason)
  const state = parseDailyPlayState(body, date)
  assert.equal(state.latestTerminalAttempt?.endReason, reason)
  assert.equal(state.latestTerminalAttempt?.roundNumber, 1)
  assert.equal(state.activeAttempt, null)
  assert.equal(state.completedRounds, 1)
  assert.equal(state.totalCoins, body.totalCoins)
  assert.equal(state.threeCoinsComplete, body.threeCoinsComplete)
  assert.equal(state.totalCoins, state.latestTerminalAttempt?.capturedCoins)
  assert.equal(state.threeCoinsComplete, reason === 'cleared' ? 1 : 0)
}

let starts = 0
const terminalState = parseDailyPlayState(dto('cashed_out'), date)
const coordinator = createDailyPlayCoordinator({
  getPlay: async () => terminalState,
  startRound: async () => {
    starts += 1
    return terminalState
  },
  getPlacements: async () => ({
    challengeDate: date,
    formationVersion: 1,
    ruleVersion: 1,
    placements: Array.from({ length: 20 }, (_, index) => ({
      roundNumber: index + 1,
      bagCount: 5,
      bombBagNumber: 5,
      coinBagNumbers: [1, 2, 3] as [number, number, number],
    })),
  }),
} as never)
const restored = await coordinator.loadOrStart(date)
assert.equal(restored.latestTerminalAttempt?.endReason, 'cashed_out')
assert.equal(starts, 0, 'reload must not auto-start the next ROUND')

const root = resolve(import.meta.dirname, '..')
const screen = readFileSync(
  resolve(root, 'src/components/DailyPlayScreen.tsx'),
  'utf8',
)
const prestart = readFileSync(
  resolve(root, 'src/components/DailyPreStartScreen.tsx'),
  'utf8',
)
assert.match(screen, /restoredTerminal\(initialState\)/)
assert.match(screen, /visibleAttempt\(initialState\)/)
assert.match(screen, /coordinator\.startNext/)
assert.match(screen, /if \(state\.activeAttempt\) return null/)
assert.match(screen, /initialState\.activeAttempt\s*\n\s*\? provisionalCoinsFromOpens/)
assert.match(screen, /dailyTerminalRemainingSeconds/)
assert.match(screen, /terminal\.result\.remainingSecondsAtTap/)
assert.match(screen, /terminal\s*\? terminalRemainingSeconds\(terminal\)/)
assert.match(screen, /\{displayedRemaining\}/)
assert.doesNotMatch(screen, /if \(!active \|\| terminal\) \{\s*setRemaining\(0\)/)
assert.match(prestart, /!state\.latestTerminalAttempt/)

console.log('daily terminal reload verification: PASS')
