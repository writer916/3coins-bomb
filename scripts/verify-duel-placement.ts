/**
 * DUEL placement pure-logic checks (no DOM).
 */
import assert from 'node:assert/strict'
import {
  backToBagsFromPlace,
  canComplete,
  canNextRound,
  clampDuelBags,
  clampDuelRounds,
  commitAndAdvance,
  completeSession,
  confirmBags,
  createDuelSession,
  createEmptyDraft,
  draftToPlacement,
  DUEL_BAGS_DEFAULT,
  DUEL_BAGS_MAX,
  DUEL_BAGS_MIN,
  DUEL_COIN_TOTAL,
  DUEL_ROUNDS_DEFAULT,
  DUEL_ROUNDS_MAX,
  DUEL_ROUNDS_MIN,
  isValidCompletedPlacement,
  hasPlacementProgress,
  lockSession,
  placeBomb,
  placeCoin,
  resetCurrentRound,
  setBagsDraft,
  startOverSession,
  totalCoins,
} from '../src/game/duelPlacement.ts'

assert.equal(DUEL_ROUNDS_MIN, 1)
assert.equal(DUEL_ROUNDS_MAX, 20)
assert.equal(DUEL_ROUNDS_DEFAULT, 5)
assert.equal(DUEL_BAGS_MIN, 3)
assert.equal(DUEL_BAGS_MAX, 8)
assert.equal(DUEL_BAGS_DEFAULT, 5)
assert.equal(DUEL_COIN_TOTAL, 3)

assert.equal(clampDuelRounds(0), 1)
assert.equal(clampDuelRounds(21), 20)
assert.equal(clampDuelRounds(5.6), 6)
assert.equal(clampDuelBags(2), 3)
assert.equal(clampDuelBags(9), 8)

let s = createDuelSession(5)
assert.equal(s.totalRounds, 5)
assert.equal(s.current?.roundNumber, 1)
assert.equal(s.current?.bagsDraft, 5)
assert.equal(s.current?.bagsSet, false)
assert.equal(s.current?.phase, 'select-bags')

// SET前: bagCount null
assert.equal(s.current?.bagCount, null)

s = {
  ...s,
  current: setBagsDraft(s.current!, 8),
}
assert.equal(s.current?.bagsDraft, 8)
s = { ...s, current: confirmBags(s.current!) }
assert.equal(s.current?.bagsSet, true)
assert.equal(s.current?.bagCount, 8)
assert.equal(s.current?.phase, 'place-bomb')

// bomb then coins
s = { ...s, current: placeBomb(s.current!, 'bag-1') }
assert.equal(s.current?.bombBagId, 'bag-1')
assert.equal(s.current?.phase, 'place-coins')

// bomb bag coin rejected
const before = s.current!
s = { ...s, current: placeCoin(s.current!, 'bag-1') }
assert.deepEqual(s.current, before)

// same bag ×3
s = { ...s, current: placeCoin(s.current!, 'bag-2') }
s = { ...s, current: placeCoin(s.current!, 'bag-2') }
s = { ...s, current: placeCoin(s.current!, 'bag-2') }
assert.equal(totalCoins(s.current!.coinCountsByBag), 3)
assert.equal(s.current!.coinCountsByBag['bag-2'], 3)
assert.equal(s.current!.phase, 'ready')
assert.equal(canNextRound(s), true)

// 4th coin blocked
const ready = s.current!
s = { ...s, current: placeCoin(s.current!, 'bag-3') }
assert.deepEqual(s.current, ready)

// ——— RESET: clear placement, keep bags, stay on place-bomb ———
{
  let r = createDuelSession(5)
  r = { ...r, current: setBagsDraft(r.current!, 7) }
  r = { ...r, current: confirmBags(r.current!) }
  assert.equal(r.current?.bagCount, 7)
  r = { ...r, current: placeBomb(r.current!, 'bag-1') }
  r = { ...r, current: placeCoin(r.current!, 'bag-2') }
  r = { ...r, current: placeCoin(r.current!, 'bag-3') }
  assert.equal(r.current?.phase, 'place-coins')
  assert.equal(totalCoins(r.current!.coinCountsByBag), 2)
  assert.equal(canNextRound(r), false)

  r = { ...r, current: resetCurrentRound(r.current!) }
  // A. bagCount=7 kept
  assert.equal(r.current?.bagCount, 7)
  assert.equal(r.current?.bagsDraft, 7)
  assert.equal(r.current?.bagsSet, true)
  assert.equal(r.current?.roundNumber, 1)
  // B. bomb cleared
  assert.equal(r.current?.bombBagId, null)
  // C. coins cleared
  assert.equal(totalCoins(r.current!.coinCountsByBag), 0)
  // D. phase → place-bomb
  assert.equal(r.current?.phase, 'place-bomb')
  // E. NEXT disabled
  assert.equal(canNextRound(r), false)
  assert.equal(canComplete(r), false)
}

// RESET from ready also clears
{
  let r = createDuelSession(3)
  r = { ...r, current: setBagsDraft(r.current!, 7) }
  r = { ...r, current: confirmBags(r.current!) }
  r = { ...r, current: placeBomb(r.current!, 'bag-1') }
  r = { ...r, current: placeCoin(r.current!, 'bag-2') }
  r = { ...r, current: placeCoin(r.current!, 'bag-2') }
  r = { ...r, current: placeCoin(r.current!, 'bag-3') }
  assert.equal(r.current?.phase, 'ready')
  assert.equal(canNextRound(r), true)
  r = { ...r, current: resetCurrentRound(r.current!) }
  assert.equal(r.current?.phase, 'place-bomb')
  assert.equal(r.current?.bagCount, 7)
  assert.equal(canNextRound(r), false)
}

// ——— Place BACK → BAG setup, keep bagsDraft, discard placement ———
{
  let b = createDuelSession(5)
  b = { ...b, current: setBagsDraft(b.current!, 7) }
  b = { ...b, current: confirmBags(b.current!) }
  b = { ...b, current: placeBomb(b.current!, 'bag-1') }
  b = { ...b, current: placeCoin(b.current!, 'bag-2') }
  b = { ...b, current: backToBagsFromPlace(b.current!) }
  // A. BAG setup
  assert.equal(b.current?.phase, 'select-bags')
  assert.equal(b.current?.bagsSet, false)
  assert.equal(b.current?.bagCount, null)
  // B. NumberStepper = 7
  assert.equal(b.current?.bagsDraft, 7)
  // C. placement discarded
  assert.equal(b.current?.bombBagId, null)
  assert.equal(totalCoins(b.current!.coinCountsByBag), 0)
  // D. re-SET → place-bomb fresh
  b = { ...b, current: confirmBags(b.current!) }
  assert.equal(b.current?.phase, 'place-bomb')
  assert.equal(b.current?.bagCount, 7)
  assert.equal(b.current?.bombBagId, null)
}

// BACK → change bags → SET
{
  let b = createDuelSession(5)
  b = { ...b, current: setBagsDraft(b.current!, 7) }
  b = { ...b, current: confirmBags(b.current!) }
  b = { ...b, current: placeBomb(b.current!, 'bag-1') }
  b = { ...b, current: backToBagsFromPlace(b.current!) }
  b = { ...b, current: setBagsDraft(b.current!, 5) }
  b = { ...b, current: confirmBags(b.current!) }
  assert.equal(b.current?.bagCount, 5)
  assert.equal(b.current?.phase, 'place-bomb')
  assert.equal(b.current?.bombBagId, null)
}

// rebuild 2+1 and NEXT
function finishRound(
  session: ReturnType<typeof createDuelSession>,
  bags: number,
  bomb: 'bag-1' | 'bag-2' | 'bag-3' | 'bag-4' | 'bag-5',
  coins: Array<{ bag: typeof bomb; n: number }>,
) {
  let cur = setBagsDraft(session.current!, bags)
  cur = confirmBags(cur)
  cur = placeBomb(cur, bomb)
  for (const c of coins) {
    for (let i = 0; i < c.n; i++) cur = placeCoin(cur, c.bag)
  }
  assert.equal(cur.phase, 'ready')
  return { ...session, current: cur }
}

s = createDuelSession(2)
s = finishRound(s, 5, 'bag-5', [
  { bag: 'bag-1', n: 2 },
  { bag: 'bag-2', n: 1 },
])
assert.equal(s.current!.coinCountsByBag['bag-1'], 2)
assert.equal(s.current!.coinCountsByBag['bag-2'], 1)
s = commitAndAdvance(s)
assert.equal(s.completed.length, 1)
assert.equal(s.current?.roundNumber, 2)
assert.equal(s.current?.bagsDraft, 5)
assert.equal(s.current?.bagsSet, false)

// NEXT ROUND after BAGS=8 → round 2 bagsDraft = 5
{
  let n = createDuelSession(3)
  n = finishRound(n, 8, 'bag-1', [{ bag: 'bag-2', n: 3 }])
  const hand1 = n.current!
  n = commitAndAdvance(n)
  assert.equal(n.current?.roundNumber, 2)
  assert.equal(n.current?.phase, 'select-bags')
  assert.equal(n.current?.bagsDraft, 5)
  assert.equal(n.completed.length, 1)
  assert.equal(n.completed[0]!.bagCount, 8)
  assert.equal(n.completed[0]!.bombBagId, hand1.bombBagId)
}

// Past ROUND hand preserved across RESET / place BACK on ROUND 2
{
  let p = createDuelSession(3)
  p = finishRound(p, 8, 'bag-1', [{ bag: 'bag-2', n: 3 }])
  p = commitAndAdvance(p)
  const saved = structuredClone(p.completed)
  p = { ...p, current: setBagsDraft(p.current!, 7) }
  p = { ...p, current: confirmBags(p.current!) }
  p = { ...p, current: placeBomb(p.current!, 'bag-1') }
  p = { ...p, current: placeCoin(p.current!, 'bag-2') }
  p = { ...p, current: resetCurrentRound(p.current!) }
  assert.deepEqual(p.completed, saved)
  p = { ...p, current: placeBomb(p.current!, 'bag-3') }
  p = { ...p, current: backToBagsFromPlace(p.current!) }
  assert.deepEqual(p.completed, saved)
  assert.equal(p.current?.bagsDraft, 7)
  assert.equal(p.current?.phase, 'select-bags')
}

// BAG setup BACK → ROUND setup keeps totalRounds intent via createDuelSession(12)
// (UI keeps roundsDraft; pure logic: leaving session recreates from draft)
{
  const roundsDraft = 12
  let bag = createDuelSession(roundsDraft)
  assert.equal(bag.totalRounds, 12)
  assert.equal(bag.current?.phase, 'select-bags')
  // simulate BAG BACK → null session; re-CONTINUE with same draft
  bag = createDuelSession(roundsDraft)
  assert.equal(bag.totalRounds, 12)
  assert.equal(bag.current?.roundNumber, 1)
  assert.equal(bag.current?.bagsDraft, 5)
}

// 1+1+1 on final then COMPLETE ≠ LOCK
s = createDuelSession(1)
s = finishRound(s, 5, 'bag-1', [
  { bag: 'bag-2', n: 1 },
  { bag: 'bag-3', n: 1 },
  { bag: 'bag-4', n: 1 },
])
assert.equal(canComplete(s), true)
assert.equal(canNextRound(s), false)
s = completeSession(s)
assert.equal(s.awaitingLock, true)
assert.equal(s.locked, false)
assert.equal(s.completed.length, 1)
assert.equal(s.current, null)

// START OVER
s = startOverSession(s)
assert.equal(s.totalRounds, 1)
assert.equal(s.completed.length, 0)
assert.equal(s.current?.roundNumber, 1)
assert.equal(s.locked, false)

// 20 ROUND path smoke
s = createDuelSession(20)
assert.equal(s.totalRounds, 20)
for (let r = 1; r <= 19; r++) {
  s = finishRound(s, 5, 'bag-1', [
    { bag: 'bag-2', n: 3 },
  ])
  s = commitAndAdvance(s)
  assert.equal(s.current?.roundNumber, r + 1)
  assert.equal(s.current?.bagsDraft, 5)
}
s = finishRound(s, 5, 'bag-1', [{ bag: 'bag-2', n: 3 }])
s = completeSession(s)
assert.equal(s.completed.length, 20)
assert.equal(s.awaitingLock, true)

// LOCK
s = lockSession(s)
assert.equal(s.locked, true)
// start over blocked
const locked = s
s = startOverSession(s)
assert.equal(s.locked, true)
assert.deepEqual(s.completed, locked.completed)

// validation helper
const p = draftToPlacement(
  finishRound(createDuelSession(1), 4, 'bag-2', [{ bag: 'bag-1', n: 3 }]).current!,
)
assert.ok(p)
assert.ok(isValidCompletedPlacement(p!))

// empty draft not ready
assert.equal(draftToPlacement(createEmptyDraft(1)), null)

// RESET / BACK no-ops on select-bags
{
  const d = createEmptyDraft(1)
  assert.deepEqual(resetCurrentRound(d), d)
  assert.deepEqual(backToBagsFromPlace(d), d)
}

// BACK progress gate (hasPlacementProgress still used for gates elsewhere)
{
  let b = createDuelSession(5)
  assert.equal(hasPlacementProgress(b), false)
  // bags draft change alone is still pristine
  b = { ...b, current: setBagsDraft(b.current!, 8) }
  assert.equal(hasPlacementProgress(b), false)
  // SET begins placement work
  b = { ...b, current: confirmBags(b.current!) }
  assert.equal(hasPlacementProgress(b), true)
  // completed round counts
  let c = createDuelSession(2)
  c = finishRound(c, 5, 'bag-1', [{ bag: 'bag-2', n: 3 }])
  c = commitAndAdvance(c)
  assert.equal(hasPlacementProgress(c), true)
  // round 2 pristine draft still has progress (not round 1)
  assert.equal(c.current?.roundNumber, 2)
  assert.equal(c.current?.bagsSet, false)
  assert.equal(hasPlacementProgress(c), true)
}

console.log('verify:duel-placement OK')
