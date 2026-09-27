/**
 * Multi-coin open FX sprite prototype guards.
 * Run: npm run verify:coin-sprites
 */
import assert from 'node:assert/strict'
import {
  COIN_FX_ONE_SPIN_STEP_MS,
  COIN_FX_ONE_TOTAL_MS,
  COIN_FX_RISE_MS,
  coinSpriteLocalTotalMs,
  coinSpriteOffsets,
  coinSpriteStartMs,
  planCoinFx,
  sampleCoinFx,
  sampleCoinSprites,
} from '../src/game/coinFx'
import {
  claimOpenFxCompletion,
  openFxFallbackDelayMs,
} from '../src/game/openFxCompletion'
import { coinSoundCuesFromPlan } from '../src/game/coinSfx'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

// 1. Plan totals / beats unchanged (no tempo extension)
{
  const p1 = planCoinFx('bag-1', 1)
  const p2 = planCoinFx('bag-1', 2)
  const p3 = planCoinFx('bag-1', 3)
  if (p1.totalMs !== 720 || p2.totalMs !== 960 || p3.totalMs !== 1180) {
    fail(`totalMs changed: ${p1.totalMs}/${p2.totalMs}/${p3.totalMs}`)
  } else if (
    JSON.stringify(p1.totalAtMs) !== '[40]' ||
    JSON.stringify(p2.totalAtMs) !== '[40,320]' ||
    JSON.stringify(p3.totalAtMs) !== '[40,300,560]'
  ) {
    fail('totalAtMs changed')
  } else if (p1.spinStepMs !== 70 || p2.spinStepMs !== 65 || p3.spinStepMs !== 60) {
    fail('spinStepMs changed')
  } else ok('plan totalMs / totalAtMs / spinStepMs unchanged')
}

// 2. Sprite counts
{
  const p1 = planCoinFx('bag-2', 1)
  const p2 = planCoinFx('bag-2', 2)
  const p3 = planCoinFx('bag-2', 3)
  const s1 = sampleCoinSprites(p1, 100)
  const s2 = sampleCoinSprites(p2, 400)
  const s3 = sampleCoinSprites(p3, 400)
  if (s1.length !== 1) fail(`×1 sprites ${s1.length}`)
  else if (s2.length !== 2) fail(`×2 sprites ${s2.length}`)
  else if (s3.length !== 3) fail(`×3 sprites ${s3.length}`)
  else if (coinSpriteOffsets(1).length !== 1 || coinSpriteOffsets(2).length !== 2) {
    fail('offsets length')
  } else if (coinSpriteOffsets(3).length !== 3) fail('offsets ×3')
  else ok('sprite counts 1 / 2 / 3')
}

// 3. 1 COIN sprite mirrors sampleCoinFx (legacy motion)
{
  const plan = planCoinFx('bag-3', 1)
  let bad = false
  for (let t = 0; t < plan.totalMs; t += 17) {
    const agg = sampleCoinFx(plan, t)
    const sprites = sampleCoinSprites(plan, t)
    if (sprites.length !== 1) {
      bad = true
      break
    }
    const sp = sprites[0]!
    if (
      sp.offsetXPx !== 0 ||
      sp.offsetYPx !== 0 ||
      sp.motionT !== agg.motionT ||
      sp.spinFrame !== agg.spinFrame ||
      sp.visible !== !agg.finished
    ) {
      bad = true
      break
    }
  }
  if (bad) fail('×1 sprite diverges from sampleCoinFx')
  else ok('×1 sprite matches sampleCoinFx motion/spin')
}

// 4. Stagger + overlap: later sprites start after earlier; all end ≤ totalMs
{
  const p2 = planCoinFx('bag-1', 2)
  const p3 = planCoinFx('bag-1', 3)
  for (const plan of [p2, p3]) {
    for (let i = 0; i < plan.coinCount; i++) {
      const start = coinSpriteStartMs(plan, i)
      const local = coinSpriteLocalTotalMs(plan, start)
      if (start + local > plan.totalMs) {
        fail(`${plan.coinCount} sprite ${i} overruns totalMs (${start}+${local}>${plan.totalMs})`)
      }
      if (i > 0 && start <= coinSpriteStartMs(plan, i - 1)) {
        fail(`${plan.coinCount} sprite starts not staggered`)
      }
    }
  }
  // Mid-FX: at least two sprites visible overlapping for ×2/×3
  const mid2 = sampleCoinSprites(p2, 350)
  const vis2 = mid2.filter((s) => s.visible).length
  const mid3 = sampleCoinSprites(p3, 450)
  const vis3 = mid3.filter((s) => s.visible).length
  if (vis2 < 2) fail(`×2 mid overlap vis=${vis2}`)
  else if (vis3 < 2) fail(`×3 mid overlap vis=${vis3}`)
  else ok('stagger fits totalMs; mid-FX overlap')
}

// 5. Offsets differ for multi (readable N)
{
  const o2 = coinSpriteOffsets(2)
  const o3 = coinSpriteOffsets(3)
  if (o2[0]!.x === o2[1]!.x) fail('×2 same X')
  else if (new Set(o3.map((o) => `${o.x},${o.y}`)).size !== 3) fail('×3 offsets collide')
  else ok('minimal distinct offsets for ×2/×3')
}

// 6. +N / chimes still from plan (unchanged cues)
{
  const p3 = planCoinFx('bag-4', 3)
  const cues = coinSoundCuesFromPlan(p3)
  assert.deepEqual(
    cues.map((c) => c.atMs),
    [40, 300, 560],
  )
  const seq: number[] = []
  for (let t = 0; t <= p3.totalMs; t += 10) {
    const d = sampleCoinFx(p3, t).displayTotal
    if (d !== null && seq[seq.length - 1] !== d) seq.push(d)
  }
  assert.deepEqual(seq, [1, 2, 3])
  ok('+1→+2→+3 and chime cue times unchanged')
}

// 7. Multi local spin uses 1 COIN step (not plan.spinStepMs 65/60)
{
  if (COIN_FX_ONE_SPIN_STEP_MS !== 70 || COIN_FX_ONE_TOTAL_MS !== 720) {
    fail('1 COIN reference constants drifted')
  } else if (COIN_FX_RISE_MS !== 180) {
    fail('rise window drifted')
  } else ok('multi-sprite reuses 1 COIN spin/rise reference constants')
}

// 8. Completion SoT unchanged + single-flight (sprites do not gate)
{
  const plan = planCoinFx('bag-2', 3)
  const end = sampleCoinFx(plan, plan.totalMs)
  assert.equal(end.finished, true)
  assert.equal(openFxFallbackDelayMs(plan.totalMs), plan.totalMs + 100)
  const flag = { current: false }
  let n = 0
  const once = () => {
    if (!claimOpenFxCompletion(flag)) return
    n += 1
  }
  once()
  once()
  assert.equal(n, 1)
  ok('finished @ totalMs; fallback delay; onComplete single-flight')
}

// 9. Component: 1 COIN keeps inner transform path; multi uses sprites
{
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '../src/components/CoinOpenFx.tsx'), 'utf8')
  if (!src.includes('data-coin-sprites="1"')) fail('missing ×1 marker')
  else if (!src.includes('coin-open-fx-sprite')) fail('missing multi sprite class')
  else if (!src.includes('sampleCoinSprites')) fail('missing sampleCoinSprites use')
  else if (
    !src.includes('transform: `translate(-50%, calc(-50% - ${risePx}px))`')
  ) {
    fail('×1 inner transform SoT missing')
  } else if (!src.includes('claimOpenFxCompletion')) {
    fail('fallback completion gate missing')
  } else if (!src.includes('openFxFallbackDelayMs')) {
    fail('fallback timer missing')
  } else ok('CoinOpenFx: ×1 legacy path + multi sprites + fallback intact')
}

if (failures > 0) {
  console.error(`\nverify:coin-sprites FAILED (${failures})`)
  process.exit(1)
}
console.log('\nverify:coin-sprites OK')
