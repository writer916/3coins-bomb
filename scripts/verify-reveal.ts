/**
 * REVEAL pure-logic verify (unopened-only + slot-center placement).
 * Run: npm run verify:reveal
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFormation } from '../src/game/formations'
import { createHiddenHand } from '../src/game/hand'
import {
  buildRevealPlan,
  canRequestReveal,
  canShowEndActions,
  countRevealCoins,
  hasRevealBomb,
  revealCoinStackCentroid,
  revealSpriteCount,
  REVEAL_COIN_STACK_OFFSETS,
  REVEAL_COIN_SIZE_FRAC,
} from '../src/game/reveal'
import {
  applyOpenBag,
  createActiveRound,
  tryCashOut,
  type RoundState,
} from '../src/game/round'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function open(
  state: RoundState,
  bagId: 'bag-1' | 'bag-2' | 'bag-3' | 'bag-4' | 'bag-5',
): RoundState {
  const r = applyOpenBag(state, bagId)
  if (!r.ok) throw new Error(`open ${bagId}: ${r.reason}`)
  return r.state
}

function nearly0(n: number, eps = 1e-9): boolean {
  return Math.abs(n) <= eps
}

/** bag-1=×1, bag-2=×2, bag-5=bomb, 3/4 empty */
function handMixed() {
  return createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-2', 'bag-2'],
  })
}

function handTriple() {
  return createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-3', 'bag-3', 'bag-3'],
  })
}

{
  if (canRequestReveal('active', false, false)) fail('active should block reveal')
  else ok('activeではREVEAL不可')
}

{
  if (
    !canRequestReveal('bombed', false, false) ||
    !canRequestReveal('cleared', false, false) ||
    !canRequestReveal('cashed-out', false, false)
  ) {
    fail('ended phases should allow reveal')
  } else if (canRequestReveal('bombed', true, false)) {
    fail('FX should block')
  } else ok('bombed / cleared / cashed-outでREVEAL可')
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1')
  round = open(round, 'bag-5') // bomb end
  const plan = buildRevealPlan(round.hand, round.history)
  if (plan.sprites.some((s) => s.bagId === 'bag-1' || s.bagId === 'bag-5')) {
    fail('opened bags must not appear')
  } else ok('opened bagはreveal itemを生成しない')
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1')
  const cash = tryCashOut(round)
  if (!cash.ok) fail('cash setup')
  else {
    round = cash.state
    const plan = buildRevealPlan(round.hand, round.history)
    // bag-3, bag-4 empty unopened → 0 items
    if (countRevealCoins(plan, 'bag-3') !== 0 || hasRevealBomb(plan, 'bag-3')) {
      fail('empty bag-3')
    } else if (countRevealCoins(plan, 'bag-4') !== 0) {
      fail('empty bag-4')
    } else ok('unopened EMPTYはitem 0')
  }
}

{
  let round = createActiveRound(handMixed())
  // open bomb only — leave ×1 unopened
  round = open(round, 'bag-5')
  const plan = buildRevealPlan(round.hand, round.history)
  if (countRevealCoins(plan, 'bag-1') !== 1) fail('unopened ×1')
  else ok('unopened COIN×1はcoin sprite 1')
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-5')
  const plan = buildRevealPlan(round.hand, round.history)
  if (countRevealCoins(plan, 'bag-2') !== 2) fail('unopened ×2')
  else ok('unopened COIN×2はcoin sprite 2')
}

{
  let round = createActiveRound(handTriple())
  round = open(round, 'bag-5') // bomb; leave ×3 unopened
  const plan = buildRevealPlan(round.hand, round.history)
  if (countRevealCoins(plan, 'bag-3') !== 3) fail('unopened ×3')
  else ok('unopened COIN×3はcoin sprite 3')
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1')
  const cash = tryCashOut(round)
  if (!cash.ok) fail('cash for bomb')
  else {
    const plan = buildRevealPlan(cash.state.hand, cash.state.history)
    if (!hasRevealBomb(plan, 'bag-5')) fail('unopened bomb missing')
    else if (plan.sprites.filter((s) => s.kind === 'bomb').length !== 1) {
      fail('bomb count')
    } else ok('unopened BOMBはbomb sprite 1')
  }
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-5') // bombed
  const plan = buildRevealPlan(round.hand, round.history)
  if (hasRevealBomb(plan, 'bag-5')) fail('opened bomb re-shown')
  else ok('BOMBで終了したopened BOMBは再表示しない')
}

{
  let round = createActiveRound(handTriple())
  round = open(round, 'bag-3') // cleared with ×3
  if (round.phase !== 'cleared') fail('setup clear')
  else {
    const plan = buildRevealPlan(round.hand, round.history)
    if (countRevealCoins(plan, 'bag-3') !== 0) fail('opened coins re-shown')
    else if (!hasRevealBomb(plan, 'bag-5')) fail('unopened bomb should show')
    else ok('3 COINS clearでopened COINは再表示しない')
  }
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1') // ×1
  round = open(round, 'bag-3') // empty
  const cash = tryCashOut(round)
  if (!cash.ok) fail('cash out')
  else {
    const plan = buildRevealPlan(cash.state.hand, cash.state.history)
    if (countRevealCoins(plan, 'bag-1') !== 0) fail('opened coin re-shown')
    else if (plan.sprites.some((s) => s.bagId === 'bag-3')) fail('opened empty')
    else if (countRevealCoins(plan, 'bag-2') !== 2) fail('remaining ×2')
    else if (!hasRevealBomb(plan, 'bag-5')) fail('remaining bomb')
    else ok('CASH OUTでopened COIN / EMPTYは再表示しない')
  }
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1')
  const cash = tryCashOut(round)
  if (!cash.ok) fail('immutable setup')
  else {
    round = cash.state
    const before = JSON.stringify(round)
    buildRevealPlan(round.hand, round.history)
    if (JSON.stringify(round) !== before) fail('mutated')
    else if (round.phase !== 'cashed-out' || round.capturedCoins !== 1) {
      fail('phase/captured')
    } else ok('REVEALしてもhand/history/capturedCoins/phase不変')
  }
}

{
  for (const n of [1, 2, 3] as const) {
    const c = revealCoinStackCentroid(n)
    if (!nearly0(c.x) || !nearly0(c.y)) {
      fail(`×${n} centroid (${c.x},${c.y}) not at origin`)
    }
  }
  if (failures === 0) ok('×1/×2/×3 group center = slot center (offset centroid 0)')
}

{
  let round = createActiveRound(handMixed())
  round = open(round, 'bag-1')
  const cash = tryCashOut(round)
  if (!cash.ok) fail('bomb center setup')
  else {
    const plan = buildRevealPlan(cash.state.hand, cash.state.history)
    const bomb = plan.sprites.find((s) => s.kind === 'bomb')
    const slot = getFormation(5).find((s) => s.bagId === 'bag-5')!
    if (!bomb) fail('no bomb')
    else if (bomb.slotX !== slot.x || bomb.slotY !== slot.y) fail('bomb slot')
    else if (bomb.offsetXBag !== 0 || bomb.offsetYBag !== 0) {
      fail('bomb offset must be 0')
    } else ok('BOMB center = slot center')
  }
}

{
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '../src/game/reveal.ts'), 'utf8')
  const importsVisual =
    /import\s*\{[^}]*\bBAG_VISUAL_CENTER_OFFSET\b/.test(src) ||
    /import\s*\{[^}]*\bvisualCenterOffsetBag\b/.test(src) ||
    /\bBAG_VISUAL_CENTER_OFFSET\[/.test(src) ||
    /\bvisualCenterOffsetBag\s*\(/.test(src)
  if (importsVisual) {
    fail('reveal.ts still references bag visual-center helpers')
  } else ok('BAG_VISUAL_CENTER_OFFSETをREVEAL placementに未使用')
}

{
  if (canRequestReveal('active', false, false)) fail('reset gate')
  else if (canShowEndActions('active', false)) fail('active end')
  else ok('NEXT ROUNDでreveal state reset（activeへ戻るとREVEAL不可）')
}

{
  // placement band unchanged first draft
  const o2 = REVEAL_COIN_STACK_OFFSETS[2]
  if (o2[0]!.x !== -o2[1]!.x || o2[0]!.y !== -o2[1]!.y) {
    fail('×2 not symmetric about origin')
  } else if (REVEAL_COIN_SIZE_FRAC !== 0.22) {
    fail(`size drifted ${REVEAL_COIN_SIZE_FRAC}`)
  } else ok('×2 symmetric / size 0.22 first draft maintained')
}

{
  let round = createActiveRound(handTriple())
  round = open(round, 'bag-5')
  const plan = buildRevealPlan(round.hand, round.history)
  const n = revealSpriteCount(plan)
  // unopened: ×3 + empties ignored; bomb opened → coins 3 bombs 0
  if (n.coins !== 3 || n.bombs !== 0) fail(`totals ${n.coins}/${n.bombs}`)
  else ok('bombed: only remaining coins in plan')
}

if (failures > 0) {
  console.error(`\nverify:reveal FAILED (${failures})`)
  process.exit(1)
}
console.log('\nverify:reveal OK')
