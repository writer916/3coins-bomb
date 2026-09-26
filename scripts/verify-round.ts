/**
 * ROUND rules verify (pure logic, no UI).
 * Run: npm run verify:round
 */
import { createHiddenHand, type HiddenHand } from '../src/game/hand'
import {
  applyOpenBag,
  canCashOut,
  createActiveRound,
  tryCashOut,
  type RoundState,
} from '../src/game/round'
import type { BagId } from '../src/game/assets'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function handWith(opts: {
  bagCount?: 5
  bombBagId: BagId
  coinTargets: readonly [BagId, BagId, BagId]
}): HiddenHand {
  return createHiddenHand({
    bagCount: opts.bagCount ?? 5,
    bombBagId: opts.bombBagId,
    coinTargets: opts.coinTargets,
  })
}

function open(
  state: RoundState,
  bagId: BagId,
): RoundState {
  const r = applyOpenBag(state, bagId)
  if (!r.ok) {
    throw new Error(`expected open ${bagId} ok, got ${r.reason}`)
  }
  return r.state
}

// 1. EMPTY → active, provisional unchanged
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-3'],
  })
  let s = createActiveRound(hand)
  const snap = JSON.stringify(hand)
  s = open(s, 'bag-4') // empty
  if (s.phase !== 'active' || s.provisionalCoins !== 0) {
    fail('EMPTY should keep active / provisional 0')
  } else if (JSON.stringify(s.hand) !== snap) {
    fail('hand mutated on EMPTY')
  } else ok('1 EMPTY → active, provisional unchanged')
}

// 2. COIN×1 → provisional 1 active
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2') // 1
  if (s.phase !== 'active' || s.provisionalCoins !== 1 || s.capturedCoins !== null) {
    fail('COIN×1 state wrong')
  } else ok('2 COIN×1 → provisional 1 active')
}

// 3. COIN×2 → provisional 2 active
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-3'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2') // 2
  if (s.phase !== 'active' || s.provisionalCoins !== 2) fail('COIN×2 wrong')
  else ok('3 COIN×2 → provisional 2 active')
}

// 4. COIN×3 → cleared / captured 3
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-2'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  if (s.phase !== 'cleared' || s.provisionalCoins !== 3 || s.capturedCoins !== 3) {
    fail('COIN×3 auto clear wrong')
  } else ok('4 COIN×3 → cleared / captured 3')
}

// 5. COIN×1 → COIN×2 → cleared
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-3'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  s = open(s, 'bag-3')
  if (s.phase !== 'cleared' || s.capturedCoins !== 3) fail('1 then 2 clear wrong')
  else ok('5 COIN×1 → COIN×2 → cleared')
}

// 6. COIN×2 → COIN×1 → cleared
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-3'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  s = open(s, 'bag-3')
  if (s.phase !== 'cleared' || s.capturedCoins !== 3) fail('2 then 1 clear wrong')
  else ok('6 COIN×2 → COIN×1 → cleared')
}

// 7. COIN×1 → CASH OUT → captured 1
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  if (!canCashOut(s)) fail('should allow cash out at 1')
  const c = tryCashOut(s)
  if (!c.ok || c.state.phase !== 'cashed-out' || c.state.capturedCoins !== 1) {
    fail('cash out 1 wrong')
  } else ok('7 COIN×1 → CASH OUT → captured 1')
}

// 8. COIN×2 → CASH OUT → captured 2
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-3'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  const c = tryCashOut(s)
  if (!c.ok || c.state.capturedCoins !== 2 || c.state.phase !== 'cashed-out') {
    fail('cash out 2 wrong')
  } else ok('8 COIN×2 → CASH OUT → captured 2')
}

// 9. provisional 0 → CASH OUT不可
{
  const s = createActiveRound(
    handWith({ bombBagId: 'bag-1', coinTargets: ['bag-2', 'bag-3', 'bag-4'] }),
  )
  if (canCashOut(s)) fail('cash out at 0 should be false')
  const c = tryCashOut(s)
  if (c.ok) fail('cash out at 0 should fail')
  else ok('9 provisional 0 → CASH OUT不可')
}

// 10. COIN×1 → BOMB → captured 0 bombed
{
  const hand = handWith({
    bombBagId: 'bag-5',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  s = open(s, 'bag-5')
  if (s.phase !== 'bombed' || s.capturedCoins !== 0 || s.provisionalCoins !== 0) {
    fail('coin then bomb wrong')
  } else ok('10 COIN×1 → BOMB → captured 0 bombed')
}

// 11. COIN×2 → BOMB → captured 0
{
  const hand = handWith({
    bombBagId: 'bag-5',
    coinTargets: ['bag-2', 'bag-2', 'bag-3'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2')
  s = open(s, 'bag-5')
  if (s.phase !== 'bombed' || s.capturedCoins !== 0) fail('2 then bomb wrong')
  else ok('11 COIN×2 → BOMB → captured 0 bombed')
}

// 12–13. ended → no more open / no cash out
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-2'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-2') // cleared
  const again = applyOpenBag(s, 'bag-3')
  if (again.ok || again.reason !== 'round-ended') fail('open after end should fail')
  if (canCashOut(s) || tryCashOut(s).ok) fail('cash out after end should fail')
  else ok('12–13 ROUND終了後 open/CASH OUT不可')
}

// 14. double open same bag
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-5') // empty
  const dup = applyOpenBag(s, 'bag-5')
  if (dup.ok || dup.reason !== 'already-opened') fail('double open should fail')
  else if (dup.state.history.length !== 1) fail('history grew on double open')
  else ok('14 同じbagId二重open不可')
}

// 15. history order
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let s = createActiveRound(hand)
  s = open(s, 'bag-5')
  s = open(s, 'bag-2')
  const order = s.history.map((h) => h.bagId).join(',')
  if (order !== 'bag-5,bag-2') fail(`history order ${order}`)
  else ok('15 開封順・履歴が保持される')
}

// 16. New ROUND initial
{
  const s = createActiveRound(
    handWith({ bombBagId: 'bag-1', coinTargets: ['bag-2', 'bag-3', 'bag-4'] }),
  )
  if (
    s.phase !== 'active' ||
    s.provisionalCoins !== 0 ||
    s.capturedCoins !== null ||
    s.history.length !== 0 ||
    s.lastReveal !== null
  ) {
    fail('initial round wrong')
  } else ok('16 New ROUND相当の初期状態')
}

// 17. hand not rewritten across opens
{
  const hand = handWith({
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  const snap = JSON.stringify(hand)
  let s = createActiveRound(hand)
  s = open(s, 'bag-5')
  s = open(s, 'bag-2')
  const c = tryCashOut(s)
  if (!c.ok) fail('cash out expected')
  if (JSON.stringify(c.state.hand) !== snap) fail('hand rewritten')
  else ok('17 hidden handそのものを書き換えない')
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log('\nAll ROUND rule checks passed.')
