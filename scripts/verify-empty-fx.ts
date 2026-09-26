/**
 * EMPTY open FX verify (pure logic, no UI).
 * Run: npm run verify:empty
 */
import { planEmptyFx, sampleEmptyFx } from '../src/game/emptyFx'
import { resolveEmptyPlacement } from '../src/game/emptyPlacement'
import { BAG_VISUAL_CENTER_OFFSET } from '../src/game/bombPlacement'
import { bagDepthZIndex, getFormation } from '../src/game/formations'
import { applyOpenBag, createActiveRound } from '../src/game/round'
import { createHiddenHand } from '../src/game/hand'
import type { BagId } from '../src/game/assets'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

{
  const plan = planEmptyFx('bag-3')
  const early = sampleEmptyFx(plan, 0)
  if (early.phase !== 'hold' || early.opacity !== plan.holdOpacity || !early.bagHidden) {
    fail(`start should show EMPTY, got phase=${early.phase} opacity=${early.opacity}`)
  } else ok('EMPTY cue開始時に表示される')
}

{
  const plan = planEmptyFx('bag-2')
  const before = sampleEmptyFx(plan, plan.fadeStartMs - 1)
  const atStart = sampleEmptyFx(plan, plan.fadeStartMs)
  const after = sampleEmptyFx(plan, plan.fadeStartMs + 20)
  if (before.phase !== 'hold') fail('pre-fade should hold')
  else if (atStart.phase !== 'fading') fail('fadeStart should enter fading')
  else if (!(after.opacity < before.opacity)) fail('fade should lower opacity')
  else ok('fade開始タイミング')
}

{
  const plan = planEmptyFx('bag-4')
  if (plan.totalMs < 500 || plan.totalMs > 700) {
    fail(`totalMs ${plan.totalMs} outside 500–700 first-draft range`)
  } else if (plan.fadeStartMs >= plan.totalMs) {
    fail('fadeStartMs must be before totalMs')
  } else if (plan.bagHideMs !== 0) {
    fail('bagHideMs should be 0')
  } else ok('EMPTY時間定数が想定範囲内')
}

{
  const plan = planEmptyFx('bag-1')
  const end = sampleEmptyFx(plan, plan.totalMs)
  const after = sampleEmptyFx(plan, plan.totalMs + 40)
  if (!end.finished || end.opacity !== 0 || end.phase !== 'done') {
    fail('end not cleared')
  } else if (!after.finished) fail('after not done')
  else ok('total終了時にFX clear')
}

{
  const a = planEmptyFx('bag-2' as BagId)
  const b = planEmptyFx('bag-7' as BagId)
  const sa = sampleEmptyFx(a, 200)
  const sb = sampleEmptyFx(b, 200)
  if (sa.bagId !== 'bag-2' || sb.bagId !== 'bag-7') fail('bagId not preserved')
  else ok('対象bagIdを保持')
}

{
  const p = resolveEmptyPlacement({ bagId: 'bag-2', bagCount: 6 })
  const vis = BAG_VISUAL_CENTER_OFFSET['bag-2']
  if (p.offsetXBag !== vis.x || p.offsetYBag !== vis.y) {
    fail('EMPTY not on bag visual center')
  } else {
    const slot = getFormation(6).find((s) => s.bagId === 'bag-2')!
    if (p.slotX !== slot.x || p.slotY !== slot.y) fail('slot drifted')
    else ok('元bagのvisual centerを使用')
  }
}

{
  const p = resolveEmptyPlacement({ bagId: 'bag-2', bagCount: 6 })
  const depth = bagDepthZIndex(6, 'bag-2')
  if (p.depthZIndex !== depth) fail('EMPTY depth != opened bag')
  else ok('元bagと同じdepthを使用')
}

{
  // 6-bag: back-row left-2 = bag-2; front bag-5 / bag-6
  const p = resolveEmptyPlacement({ bagId: 'bag-2', bagCount: 6 })
  const front5 = bagDepthZIndex(6, 'bag-5')
  const front6 = bagDepthZIndex(6, 'bag-6')
  if (!(p.depthZIndex < front5 && p.depthZIndex < front6)) {
    fail(`back EMPTY depth ${p.depthZIndex} should be behind front`)
  } else ok('後列EMPTYは前列bagより奥')
}

{
  const p = resolveEmptyPlacement({ bagId: 'bag-5', bagCount: 6 })
  const back2 = bagDepthZIndex(6, 'bag-2')
  if (!(p.depthZIndex > back2)) fail('front EMPTY should be above back bag')
  else ok('前列EMPTYは後列bagより手前')
}

{
  const cases: { count: 5 | 6 | 7 | 8; back: BagId; front: BagId }[] = [
    { count: 5, back: 'bag-2', front: 'bag-4' },
    { count: 6, back: 'bag-2', front: 'bag-5' },
    { count: 7, back: 'bag-2', front: 'bag-6' },
    { count: 8, back: 'bag-3', front: 'bag-6' },
  ]
  let bad = false
  for (const c of cases) {
    const empty = resolveEmptyPlacement({ bagId: c.back, bagCount: c.count })
    const frontZ = bagDepthZIndex(c.count, c.front)
    if (!(empty.depthZIndex < frontZ)) {
      bad = true
      fail(`${c.count}-bag back EMPTY not behind front`)
    }
    if (empty.depthZIndex !== bagDepthZIndex(c.count, c.back)) {
      bad = true
      fail('depth not from opened bag rule')
    }
  }
  if (!bad) ok('5～8袋: 後列EMPTY < 前列袋 depth')
}

{
  // ROUND: EMPTY open stays active; FX sampling does not mutate state
  const hand = createHiddenHand({
    bagCount: 6,
    bombBagId: 'bag-1',
    coinTargets: ['bag-4', 'bag-5', 'bag-6'],
  })
  let round = createActiveRound(hand)
  const snapHand = JSON.stringify(round.hand)
  const beforeProv = round.provisionalCoins
  const opened = applyOpenBag(round, 'bag-2')
  if (!opened.ok) fail('open empty failed')
  else if (opened.reveal.contents.kind !== 'empty') fail('expected empty contents')
  else {
    round = opened.state
    const plan = planEmptyFx('bag-2')
    sampleEmptyFx(plan, 0)
    sampleEmptyFx(plan, plan.fadeStartMs)
    sampleEmptyFx(plan, plan.totalMs)
    if (round.phase !== 'active') fail('phase not active after EMPTY')
    else if (round.provisionalCoins !== beforeProv) fail('provisionalCoins changed')
    else if (round.capturedCoins !== null) fail('capturedCoins should stay null')
    else if (JSON.stringify(round.hand) !== snapHand) fail('hand mutated by EMPTY FX')
    else ok('EMPTY FXがROUND stateを書き換えない / active / provisional不変 / captured=null')
  }
}

{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-1',
    coinTargets: ['bag-3', 'bag-4', 'bag-5'],
  })
  let round = createActiveRound(hand)
  const first = applyOpenBag(round, 'bag-2')
  if (!first.ok) fail('first empty open failed')
  else {
    round = first.state
    const again = applyOpenBag(round, 'bag-2')
    if (again.ok) fail('same bag opened twice')
    else if (round.phase !== 'active') fail('should remain active')
    else ok('同じbagを再度開けられない / EMPTY後もactive')
  }
}

{
  const plan = planEmptyFx('bag-3')
  const frozen = JSON.stringify(plan)
  sampleEmptyFx(plan, 100)
  sampleEmptyFx(plan, plan.totalMs)
  if (JSON.stringify(plan) !== frozen) fail('plan mutated')
  else ok('EMPTY FXがplanを書き換えない')
}

if (failures > 0) {
  console.error(`\n${failures} EMPTY FX check(s) failed.`)
  process.exit(1)
}

console.log('\nAll EMPTY FX checks passed.')
