/** DUEL server-domain and secrecy-boundary checks (pure logic, no DOM). */
import assert from 'node:assert/strict'
import {
  areBothPlacementsLocked,
  createDuelMatch,
  deriveDuelMatchState,
  isParticipantCompleted,
  isRevealable,
  lockParticipantPlacements,
  recordParticipantRoundResult,
  setParticipantPlacements,
  toParticipantView,
  toRevealView,
  type DuelMatchInternalState,
  type DuelRoundPlayResult,
} from '../src/game/duelMatch.ts'
import type { DuelRoundPlacement } from '../src/game/duelPlacement.ts'

function placement(
  roundNumber: number,
  bombBagId: 'bag-1' | 'bag-2',
): DuelRoundPlacement {
  return bombBagId === 'bag-1'
    ? {
        roundNumber,
        bagCount: 5,
        bombBagId,
        coinCountsByBag: { 'bag-2': 2, 'bag-3': 1 },
      }
    : {
        roundNumber,
        bagCount: 5,
        bombBagId,
        coinCountsByBag: { 'bag-1': 1, 'bag-3': 1, 'bag-4': 1 },
      }
}

function expectOk<T>(result: { ok: boolean; state: T }): T {
  assert.equal(result.ok, true)
  return result.state
}

function setAndLock(
  match: DuelMatchInternalState,
  id: 'A' | 'B',
  placements: readonly DuelRoundPlacement[],
): DuelMatchInternalState {
  const withPlacements = expectOk(setParticipantPlacements(match, id, placements))
  return expectOk(lockParticipantPlacements(withPlacements, id))
}

function result(roundNumber: number, bombHit = false): DuelRoundPlayResult {
  return {
    roundNumber,
    capturedCoins: bombHit ? 0 : 2,
    bombHit,
    openedBagCount: 2,
  }
}

const created = createDuelMatch('match-1', 2)
let match = expectOk(created)
assert.equal(deriveDuelMatchState(match), 'placement')
assert.equal(areBothPlacementsLocked(match), false)
assert.equal(isRevealable(match), false)

assert.equal(createDuelMatch('', 2).ok, false)
assert.equal(createDuelMatch('x', 0).ok, false)
assert.equal(createDuelMatch('x', 21).ok, false)

const aPlacements = [placement(1, 'bag-1'), placement(2, 'bag-2')]
const bPlacements = [placement(1, 'bag-2'), placement(2, 'bag-1')]

// Full, ordered, valid placement set is required.
assert.equal(setParticipantPlacements(match, 'A', [aPlacements[0]]).ok, false)
assert.equal(
  setParticipantPlacements(match, 'A', [aPlacements[1], aPlacements[0]]).ok,
  false,
)
match = expectOk(setParticipantPlacements(match, 'A', aPlacements))
match = expectOk(lockParticipantPlacements(match, 'A'))
assert.equal(match.participants.A.placementLocked, true)
assert.equal(deriveDuelMatchState(match), 'placement')

// LOCK is immutable and idempotent.
assert.equal(setParticipantPlacements(match, 'A', bPlacements).ok, false)
assert.equal(lockParticipantPlacements(match, 'A').ok, true)

// Play cannot start until both participants are locked.
assert.equal(recordParticipantRoundResult(match, 'A', result(1)).ok, false)
match = setAndLock(match, 'B', bPlacements)
assert.equal(areBothPlacementsLocked(match), true)
assert.equal(deriveDuelMatchState(match), 'playable')

// Participant view exposes own placement, never opponent placement fields.
const aView = toParticipantView(match, 'A')
const bView = toParticipantView(match, 'B')
assert.deepEqual(aView.self.placements, aPlacements)
assert.deepEqual(bView.self.placements, bPlacements)
assert.equal('placements' in aView.opponent, false)
assert.equal('bombBagId' in aView.opponent, false)
assert.equal('coinCountsByBag' in aView.opponent, false)
assert.equal('results' in aView.opponent.progress, false)
assert.equal('placements' in bView.opponent, false)
assert.equal(JSON.stringify(aView.opponent).includes('bombBagId'), false)
assert.equal(JSON.stringify(aView.opponent).includes('coinCountsByBag'), false)
assert.equal(JSON.stringify(bView.opponent).includes('bombBagId'), false)
assert.equal(JSON.stringify(bView.opponent).includes('coinCountsByBag'), false)
assert.equal(JSON.stringify(aView).toLowerCase().includes('token'), false)

// A and B progress independently; B remaining on ROUND 1 never blocks A.
match = expectOk(recordParticipantRoundResult(match, 'A', result(1)))
match = expectOk(recordParticipantRoundResult(match, 'A', result(2, true)))
assert.equal(isParticipantCompleted(match, 'A'), true)
assert.equal(isParticipantCompleted(match, 'B'), false)
assert.equal(deriveDuelMatchState(match), 'in-progress')
assert.equal(isRevealable(match), false)
assert.equal(toRevealView(match).ok, false)
assert.equal(toParticipantView(match, 'B').opponent.progress.playedRounds, 2)

// Results must be contiguous and respect basic result invariants.
assert.equal(recordParticipantRoundResult(match, 'B', result(2)).ok, false)
assert.equal(
  recordParticipantRoundResult(match, 'B', {
    roundNumber: 1,
    capturedCoins: 1,
    bombHit: true,
    openedBagCount: 1,
  }).ok,
  false,
)
assert.equal(
  recordParticipantRoundResult(match, 'B', {
    ...result(1),
    openedBagCount: 6,
  }).ok,
  false,
)

match = expectOk(recordParticipantRoundResult(match, 'B', result(1)))
assert.equal(isRevealable(match), false)
match = expectOk(recordParticipantRoundResult(match, 'B', result(2)))
assert.equal(isParticipantCompleted(match, 'B'), true)
assert.equal(isRevealable(match), true)
assert.equal(deriveDuelMatchState(match), 'revealable')

const reveal = toRevealView(match)
assert.equal(reveal.ok, true)
if (reveal.ok) {
  assert.deepEqual(reveal.view.participants.A.placements, aPlacements)
  assert.deepEqual(reveal.view.participants.B.placements, bPlacements)
}

// Returned input/view objects are copied at the secrecy boundary.
assert.notEqual(match.participants.A.placements, aPlacements)
assert.notEqual(toParticipantView(match, 'A').self.placements, match.participants.A.placements)

console.log('verify:duel-match OK')
