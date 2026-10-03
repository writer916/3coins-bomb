import assert from 'node:assert/strict'
import type { DuelFinalResult, DuelPlayState } from '../src/duel/duelPlayClient'
import { resolveDuelLockedResume } from '../src/duel/duelLockedResume'
import { duelPlayHasSelfOpenedBags } from '../src/duel/duelPlayStarted'

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
  winner: 'draw',
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
  },
}

const playWaiting: DuelFinalResult = {
  matchId: MATCH_ID,
  status: 'waiting',
  selfCompleted: false,
  opponentCompleted: false,
}

function playState(openedCount: number): DuelPlayState {
  const openedBags = Array.from({ length: openedCount }, (_, i) => ({
    bagNumber: i + 1,
    openOrder: i + 1,
    outcome: 'empty' as const,
    coinsFound: 0 as const,
  }))
  return {
    matchId: MATCH_ID,
    role: 'A',
    totalRounds: 1,
    participantCompleted: false,
    nextPlayableRoundNumber: 1,
    selfProgress: {
      completedRounds: 0,
      totalCapturedCoins: 0,
      threeCoinsComplete: 0,
    },
    activeRound: {
      roundNumber: 1,
      bagCount: 3,
      openedBags,
      provisionalCoins: 0,
      nextOpenOrder: openedCount + 1,
    },
    latestTerminalRound: null,
  }
}

assert.equal(duelPlayHasSelfOpenedBags(playState(0)), false)
assert.equal(duelPlayHasSelfOpenedBags(playState(1)), true)
assert.equal(
  duelPlayHasSelfOpenedBags({
    ...playState(0),
    selfProgress: {
      completedRounds: 1,
      totalCapturedCoins: 1,
      threeCoinsComplete: 0,
    },
    activeRound: {
      roundNumber: 2,
      bagCount: 3,
      openedBags: [],
      provisionalCoins: 0,
      nextOpenOrder: 1,
    },
    latestTerminalRound: {
      roundNumber: 1,
      bagCount: 3,
      openedBags: [
        {
          bagNumber: 1,
          openOrder: 1,
          outcome: 'coins',
          coinsFound: 1,
        },
      ],
      endReason: 'cashed_out',
      capturedCoins: 1,
      openedBagCount: 1,
    },
    nextPlayableRoundNumber: 2,
    totalRounds: 2,
  }),
  true,
)

const bothLocked = {
  matchId: MATCH_ID,
  self: { claimed: true as const, placementLocked: true as const },
  opponent: { claimed: true as const, placementLocked: true as const },
}

/* 1. self locked / opponent unlocked → waiting-for-opponent-lock (no result/play) */
{
  let resultFetched = 0
  let playFetched = 0
  const route = await resolveDuelLockedResume({
    match: {
      matchId: MATCH_ID,
      self: { claimed: true, placementLocked: true },
      opponent: { claimed: false, placementLocked: false },
    },
    fetchResult: async () => {
      resultFetched += 1
      return waiting
    },
    fetchPlayState: async () => {
      playFetched += 1
      return playState(0)
    },
  })
  assert.equal(route.kind, 'waiting-for-opponent-lock')
  assert.equal(resultFetched, 0)
  assert.equal(playFetched, 0)
}

/* 2. both locked + self incomplete + 0 OPEN → start-confirm */
{
  let playFetched = 0
  const route = await resolveDuelLockedResume({
    match: bothLocked,
    fetchResult: async () => playWaiting,
    fetchPlayState: async () => {
      playFetched += 1
      return playState(0)
    },
  })
  assert.equal(route.kind, 'start-confirm')
  assert.equal(playFetched, 1)
}

/* 3. both locked + self incomplete + 1 OPEN → play */
{
  const route = await resolveDuelLockedResume({
    match: bothLocked,
    fetchResult: async () => playWaiting,
    fetchPlayState: async () => playState(1),
  })
  assert.equal(route.kind, 'play')
}

/* 4. both locked + self complete / opp incomplete → waiting-for-opponent-complete (no play) */
{
  let playFetched = 0
  const route = await resolveDuelLockedResume({
    match: bothLocked,
    fetchResult: async () => waiting,
    fetchPlayState: async () => {
      playFetched += 1
      return playState(1)
    },
  })
  assert.equal(route.kind, 'waiting-for-opponent-complete')
  assert.equal(playFetched, 0)
  if (route.kind === 'waiting-for-opponent-complete') {
    assert.equal(route.initialResult.status, 'waiting')
  }
}

/* 5. both complete → result-ready (no play) */
{
  let playFetched = 0
  const route = await resolveDuelLockedResume({
    match: bothLocked,
    fetchResult: async () => completed,
    fetchPlayState: async () => {
      playFetched += 1
      return playState(1)
    },
  })
  assert.equal(route.kind, 'result-ready')
  assert.equal(playFetched, 0)
  if (route.kind === 'result-ready') {
    assert.equal(route.initialResult.status, 'completed')
  }
}

/* 6. unlocked self → error (out of scope) */
{
  await assert.rejects(
    () =>
      resolveDuelLockedResume({
        match: {
          matchId: MATCH_ID,
          self: { claimed: true, placementLocked: false },
          opponent: { claimed: true, placementLocked: true },
        },
        fetchResult: async () => playWaiting,
        fetchPlayState: async () => playState(0),
      }),
  )
}

/* 7. GET result failure → error, no guessed route */
{
  await assert.rejects(
    () =>
      resolveDuelLockedResume({
        match: bothLocked,
        fetchResult: async () => {
          throw new Error('network')
        },
        fetchPlayState: async () => playState(0),
      }),
  )
}

/* 8. GET play failure when incomplete → error */
{
  await assert.rejects(
    () =>
      resolveDuelLockedResume({
        match: bothLocked,
        fetchResult: async () => playWaiting,
        fetchPlayState: async () => {
          throw new Error('network')
        },
      }),
  )
}

console.log('verify-duel-locked-resume: all checks passed')
