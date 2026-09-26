/**
 * Lightweight verify for bag-open state (no UI / no test framework).
 * Run: npm run verify:open
 */
import { createHiddenHand } from '../src/game/hand'
import {
  formatOpenResultLabel,
  isBagOpened,
  openedBagIds,
  tryOpenBag,
  type OpenReveal,
} from '../src/game/open'
import type { BagId } from '../src/game/assets'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

const hand = createHiddenHand({
  bagCount: 5,
  bombBagId: 'bag-1',
  coinTargets: ['bag-2', 'bag-2', 'bag-3'],
})

const handSnapshot = JSON.stringify(hand)
let history: readonly OpenReveal[] = []

{
  const r = tryOpenBag(hand, history, 'bag-4')
  if (!r.ok) fail('first open bag-4 should succeed')
  else if (r.reveal.contents.kind !== 'empty') fail('bag-4 should be EMPTY')
  else if (r.reveal.order !== 0) fail('first order should be 0')
  else if (formatOpenResultLabel(r.reveal.contents) !== 'EMPTY') {
    fail('label EMPTY mismatch')
  } else {
    history = r.history
    ok('unopened bag can open; result matches hand (EMPTY)')
  }
}

{
  const r = tryOpenBag(hand, history, 'bag-2')
  if (!r.ok) fail('open bag-2 should succeed')
  else if (r.reveal.contents.kind !== 'coins' || r.reveal.contents.coinCount !== 2) {
    fail('bag-2 should be COIN ×2')
  } else if (r.reveal.order !== 1) fail('second order should be 1')
  else if (formatOpenResultLabel(r.reveal.contents) !== 'COIN ×2') {
    fail('label COIN ×2 mismatch')
  } else {
    history = r.history
    ok('second bag opens in order; COIN ×2 matches hand')
  }
}

{
  const beforeLen = history.length
  const r = tryOpenBag(hand, history, 'bag-2')
  if (r.ok) fail('double open bag-2 should fail')
  else if (r.reason !== 'already-opened') fail(`expected already-opened, got ${r.reason}`)
  else if (r.history.length !== beforeLen) fail('history must not grow on double open')
  else ok('same bagId cannot open twice; history unchanged')
}

{
  const r = tryOpenBag(hand, history, 'bag-1')
  if (!r.ok) fail('open bomb bag should succeed')
  else if (r.reveal.contents.kind !== 'bomb') fail('bag-1 should be BOMB')
  else if (formatOpenResultLabel(r.reveal.contents) !== 'BOMB') fail('label BOMB mismatch')
  else {
    history = r.history
    ok('BOMB reveal matches hand')
  }
}

{
  const ids = openedBagIds(history)
  if (!ids.has('bag-4') || !ids.has('bag-2') || !ids.has('bag-1')) {
    fail('opened set missing ids')
  }
  if (ids.has('bag-3') || ids.has('bag-5')) fail('unopened bags must not be in opened set')
  if (ids.size !== 3) fail(`opened size ${ids.size} !== 3`)
  if (!isBagOpened(history, 'bag-2') || isBagOpened(history, 'bag-5')) {
    fail('isBagOpened mismatch')
  }
  ok('only opened bags are marked; others remain closed')
}

{
  const order = history.map((e) => e.bagId).join(',')
  if (order !== 'bag-4,bag-2,bag-1') fail(`open order ${order}`)
  else ok('open order preserved')
}

{
  const fakeId = 'bag-9' as BagId
  const r = tryOpenBag(hand, history, fakeId)
  if (r.ok || r.reason !== 'unknown-bag') fail('unknown bag should fail')
  else ok('unknown bagId rejected')
}

if (JSON.stringify(hand) !== handSnapshot) {
  fail('hidden hand was mutated by opens')
} else {
  ok('hidden hand not rewritten by opens')
}

{
  const next = createHiddenHand({
    bagCount: 4,
    bombBagId: 'bag-2',
    coinTargets: ['bag-1', 'bag-1', 'bag-1'],
  })
  const resetHistory: readonly OpenReveal[] = []
  const fresh = tryOpenBag(next, resetHistory, 'bag-3')
  if (!fresh.ok || fresh.history.length !== 1 || fresh.reveal.order !== 0) {
    fail('reset open failed')
  } else if (fresh.history === history) {
    fail('fresh history must be a new sequence')
  } else {
    ok('new hand + empty history behaves as fresh ROUND')
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log('\nAll open-bag checks passed.')
