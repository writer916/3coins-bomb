import assert from 'node:assert/strict'
import type { DuelFinalResult } from '../src/duel/duelPlayClient'
import { resolveDuelLockedResume } from '../src/duel/duelLockedResume'

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

/* 1. self locked / opponent unlocked → waiting-for-opponent-lock (no result fetch) */
{
  let fetched = 0
  const route = await resolveDuelLockedResume({
    match: {
      matchId: MATCH_ID,
      self: { claimed: true, placementLocked: true },
      opponent: { claimed: false, placementLocked: false },
    },
    fetchResult: async () => {
      fetched += 1
      return waiting
    },
  })
  assert.equal(route.kind, 'waiting-for-opponent-lock')
  assert.equal(fetched, 0)
}

/* 2. both locked + self incomplete → play */
{
  const route = await resolveDuelLockedResume({
    match: {
      matchId: MATCH_ID,
      self: { claimed: true, placementLocked: true },
      opponent: { claimed: true, placementLocked: true },
    },
    fetchResult: async () => playWaiting,
  })
  assert.equal(route.kind, 'play')
}

/* 3. both locked + self complete / opp incomplete → waiting-for-opponent-complete */
{
  const route = await resolveDuelLockedResume({
    match: {
      matchId: MATCH_ID,
      self: { claimed: true, placementLocked: true },
      opponent: { claimed: true, placementLocked: true },
    },
    fetchResult: async () => waiting,
  })
  assert.equal(route.kind, 'waiting-for-opponent-complete')
  if (route.kind === 'waiting-for-opponent-complete') {
    assert.equal(route.initialResult.status, 'waiting')
  }
}

/* 4. both complete → result-ready */
{
  const route = await resolveDuelLockedResume({
    match: {
      matchId: MATCH_ID,
      self: { claimed: true, placementLocked: true },
      opponent: { claimed: true, placementLocked: true },
    },
    fetchResult: async () => completed,
  })
  assert.equal(route.kind, 'result-ready')
  if (route.kind === 'result-ready') {
    assert.equal(route.initialResult.status, 'completed')
  }
}

/* 5. unlocked self → error (out of scope) */
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
      }),
  )
}

/* 6. GET result failure → error, no guessed route */
{
  await assert.rejects(
    () =>
      resolveDuelLockedResume({
        match: {
          matchId: MATCH_ID,
          self: { claimed: true, placementLocked: true },
          opponent: { claimed: true, placementLocked: true },
        },
        fetchResult: async () => {
          throw new Error('network')
        },
      }),
  )
}

console.log('verify-duel-locked-resume: all checks passed')
