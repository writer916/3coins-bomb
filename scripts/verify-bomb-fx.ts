/**
 * BOMB open FX verify (pure logic, no UI).
 * Run: npm run verify:bomb
 */
import { planBombFx, sampleBombFx } from '../src/game/bombFx'
import {
  BOMB_MAX_SECONDARY_OFFSET,
  BOMB_SIZE_FRAC_OF_BAG,
  bombPlacementOffsetMagnitude,
  resolveBombPlacement,
  visualCenterOffsetBag,
} from '../src/game/bombPlacement'
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
  const plan = planBombFx('bag-3')
  const early = sampleBombFx(plan, 40)
  if (early.frame !== 'bomb-off' || early.phase !== 'off') {
    fail(`start should be bomb-off, got ${early.frame}/${early.phase}`)
  } else ok('開始時は bomb-off')
}

{
  const plan = planBombFx('bag-3')
  const before = sampleBombFx(plan, plan.igniteMs - 1)
  const after = sampleBombFx(plan, plan.igniteMs)
  if (before.frame !== 'bomb-off') fail('pre-ignite still off')
  else if (after.frame !== 'bomb-on' || after.phase !== 'lit') {
    fail(`post-ignite expected bomb-on/lit, got ${after.frame}/${after.phase}`)
  } else ok('短い間の後 bomb-on')
}

{
  const plan = planBombFx('bag-3')
  const lit = sampleBombFx(plan, plan.igniteMs + 20)
  const fading = sampleBombFx(plan, plan.fadeStartMs + 10)
  if (!lit.shaking || lit.phase !== 'lit') fail('lit should shake')
  else if (fading.shaking || fading.phase !== 'fading') fail('fade should not shake')
  else ok('点火後に shake phaseへ入る')
}

{
  const plan = planBombFx('bag-2')
  if (plan.totalMs < 700 || plan.totalMs > 1000) {
    fail(`totalMs ${plan.totalMs} outside 700–1000 first-draft range`)
  } else if (plan.igniteMs < 100 || plan.igniteMs > 250) {
    fail(`igniteMs ${plan.igniteMs} outside 100–250 guide`)
  } else ok('全体時間が想定範囲内')
}

{
  const plan = planBombFx('bag-4')
  const end = sampleBombFx(plan, plan.totalMs)
  const after = sampleBombFx(plan, plan.totalMs + 50)
  if (!end.finished || end.opacity !== 0) fail('end not cleared')
  else if (!after.finished || after.phase !== 'done') fail('after not done')
  else ok('終了後 FX stateがクリアされる')
}

{
  const a = planBombFx('bag-2' as BagId)
  const b = planBombFx('bag-7' as BagId)
  const sa = sampleBombFx(a, 200)
  const sb = sampleBombFx(b, 200)
  if (sa.bagId !== 'bag-2' || sb.bagId !== 'bag-7') fail('bagId not preserved')
  else if (a.bagId === b.bagId) fail('plans share bagId')
  else ok('対象 bagId が保持される / 起点が混線しない')
}

{
  const plan = planBombFx('bag-5')
  const frozen = JSON.stringify(plan)
  sampleBombFx(plan, 100)
  sampleBombFx(plan, plan.totalMs)
  if (JSON.stringify(plan) !== frozen) fail('plan mutated')
  else ok('BOMB FX が plan を書き換えない')
}

{
  // ROUND bombed independently of FX sampling
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let round = createActiveRound(hand)
  const snap = JSON.stringify(round.hand)
  const opened = applyOpenBag(round, 'bag-5')
  if (!opened.ok) fail('open bomb failed')
  else {
    round = opened.state
    const plan = planBombFx('bag-5')
    sampleBombFx(plan, plan.igniteMs)
    sampleBombFx(plan, plan.totalMs)
    if (round.phase !== 'bombed' || round.capturedCoins !== 0) {
      fail('ROUND not bombed correctly')
    } else if (JSON.stringify(round.hand) !== snap) {
      fail('hand mutated')
    } else ok('BOMB FX が ROUND state を書き換えない')
  }
}

{
  // Instant bag hide from t=0
  const plan = planBombFx('bag-1')
  const t0 = sampleBombFx(plan, 0)
  if (!t0.bagHidden) fail('bag should hide at t=0')
  else ok('袋はほぼ瞬時に非表示（bagHideMs=0）')
}

{
  // No upward-flight fields — opacity only during fade
  const plan = planBombFx('bag-1')
  const mid = sampleBombFx(plan, 300)
  if (mid.opacity !== 1) fail('pre-fade opacity should be 1')
  else ok('飛行なし・点火中は opacity 1')
}

// --- Placement (visual center + secondary) ---
{
  const a = resolveBombPlacement({
    bagId: 'bag-4',
    bagCount: 5,
    remainingBagIds: ['bag-1', 'bag-2', 'bag-3', 'bag-5'],
  })
  const b = resolveBombPlacement({
    bagId: 'bag-4',
    bagCount: 5,
    remainingBagIds: ['bag-1', 'bag-2', 'bag-3', 'bag-5'],
  })
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('placement not deterministic')
  else ok('同じ formation / bagId / remaining → 同じ位置')
}

{
  const vis = visualCenterOffsetBag('bag-2')
  const p = resolveBombPlacement({
    bagId: 'bag-2',
    bagCount: 3,
    remainingBagIds: ['bag-1', 'bag-3'],
  })
  // visual term must match pure visual helper
  if (
    Math.abs(p.visualOffsetXBag - vis.x) > 1e-9 ||
    Math.abs(p.visualOffsetYBag - vis.y) > 1e-9
  ) {
    fail('visual center not applied')
  } else ok('visual center補正が決定的')
}

{
  const counts = [3, 4, 5, 6, 7, 8] as const
  let bad = false
  for (const count of counts) {
    for (let i = 1; i <= count; i++) {
      const bagId = `bag-${i}` as BagId
      const remaining: BagId[] = []
      for (let j = 1; j <= count; j++) {
        if (j !== i) remaining.push(`bag-${j}` as BagId)
      }
      const p = resolveBombPlacement({ bagId, bagCount: count, remainingBagIds: remaining })
      const secMag = Math.hypot(p.secondaryOffsetXBag, p.secondaryOffsetYBag)
      if (secMag > BOMB_MAX_SECONDARY_OFFSET + 1e-9) {
        bad = true
        fail(`secondary too large ${count}/${bagId}: ${secMag}`)
        break
      }
      // Total should stay near visual center (visual + ≤ max secondary)
      const visMag = Math.hypot(p.visualOffsetXBag, p.visualOffsetYBag)
      const totMag = bombPlacementOffsetMagnitude(p)
      if (totMag > visMag + BOMB_MAX_SECONDARY_OFFSET + 1e-6) {
        bad = true
        fail(`total offset broke visual relation ${count}/${bagId}`)
        break
      }
      if (p.slotX !== getFormation(count).find((s) => s.bagId === bagId)!.x) {
        bad = true
        fail('slot mutated')
        break
      }
    }
    if (bad) break
  }
  if (!bad) ok('二次offset上限 / visual関係 / slot不変')
}

{
  // Formations themselves unchanged (spot-check 8-bag coords)
  const f8 = getFormation(8)
  if (
    f8[0]!.x !== 18 ||
    f8[7]!.x !== 80 ||
    f8[5]!.y !== 54.5
  ) {
    fail('formation coords changed')
  } else ok('他bag座標（formation）を変更しない')
}

{
  // Timings / size constants unchanged
  const plan = planBombFx('bag-1')
  if (
    plan.totalMs !== 880 ||
    plan.igniteMs !== 160 ||
    plan.fadeStartMs !== 700 ||
    BOMB_SIZE_FRAC_OF_BAG !== 0.52
  ) {
    fail('BOMB timing or size changed')
  } else ok('BOMB時間・サイズ定数維持')
}

// --- Depth / z-index (inherit opened bag) ---
{
  // 6-bag: back row left-2 = bag-2 (y=36); front bag-5 (y=51), bag-6 (y=54.5)
  const p = resolveBombPlacement({
    bagId: 'bag-2',
    bagCount: 6,
    remainingBagIds: ['bag-1', 'bag-3', 'bag-4', 'bag-5', 'bag-6'],
  })
  const front5 = bagDepthZIndex(6, 'bag-5')
  const front6 = bagDepthZIndex(6, 'bag-6')
  const bag2Depth = bagDepthZIndex(6, 'bag-2')
  if (p.depthZIndex !== bag2Depth) fail('bomb depth != opened bag depth')
  else if (!(p.depthZIndex < front5 && p.depthZIndex < front6)) {
    fail(
      `6-bag bag-2 bomb depth ${p.depthZIndex} should be behind front ${front5}/${front6}`,
    )
  } else ok('6袋・後列左から2番目BOMBは前列より奥')
}

{
  // Front-row bomb stays in front of back-row bags
  const p = resolveBombPlacement({
    bagId: 'bag-5',
    bagCount: 6,
    remainingBagIds: ['bag-1', 'bag-2', 'bag-3', 'bag-4', 'bag-6'],
  })
  const back2 = bagDepthZIndex(6, 'bag-2')
  if (!(p.depthZIndex > back2)) fail('front bomb should be above back bag')
  else ok('前列BOMBは後列袋より手前')
}

{
  // Same depth rule across 5–8: back < front
  const cases: { count: 5 | 6 | 7 | 8; back: BagId; front: BagId }[] = [
    { count: 5, back: 'bag-2', front: 'bag-4' },
    { count: 6, back: 'bag-2', front: 'bag-5' },
    { count: 7, back: 'bag-2', front: 'bag-6' },
    { count: 8, back: 'bag-3', front: 'bag-6' },
  ]
  let bad = false
  for (const c of cases) {
    const remaining: BagId[] = []
    for (let i = 1; i <= c.count; i++) {
      const id = `bag-${i}` as BagId
      if (id !== c.back) remaining.push(id)
    }
    const bomb = resolveBombPlacement({
      bagId: c.back,
      bagCount: c.count,
      remainingBagIds: remaining,
    })
    const frontZ = bagDepthZIndex(c.count, c.front)
    if (!(bomb.depthZIndex < frontZ)) {
      bad = true
      fail(`${c.count}-bag back bomb not behind front`)
      break
    }
    if (bomb.depthZIndex !== bagDepthZIndex(c.count, c.back)) {
      bad = true
      fail('depth not from opened bag rule')
      break
    }
  }
  if (!bad) ok('5～8袋: 後列BOMB < 前列袋 depth')
}

{
  // No +40 (or any) boost: depth equals Math.round(slot.y)
  const slot = getFormation(6).find((s) => s.bagId === 'bag-2')!
  const p = resolveBombPlacement({
    bagId: 'bag-2',
    bagCount: 6,
    remainingBagIds: ['bag-1', 'bag-3', 'bag-4', 'bag-5', 'bag-6'],
  })
  if (p.depthZIndex !== Math.round(slot.y)) fail('depth diverged from slot.y rule')
  else ok('元bagと同等のdepth規則を使用')
}

{
  // Shake does not change depth (depth is placement-only, not sampled)
  const p = resolveBombPlacement({
    bagId: 'bag-2',
    bagCount: 6,
    remainingBagIds: ['bag-1', 'bag-3', 'bag-4', 'bag-5', 'bag-6'],
  })
  const plan = planBombFx('bag-2')
  const lit = sampleBombFx(plan, 300)
  if (!lit.shaking) fail('expected shake sample')
  else if (p.depthZIndex !== bagDepthZIndex(6, 'bag-2')) fail('depth drifted')
  else ok('shake中もdepth不変（placement固定）')
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log('\nAll BOMB FX checks passed.')
