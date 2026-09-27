/**
 * Open-FX wall-clock fallback + single-flight completion gate.
 */
import assert from 'node:assert/strict'
import {
  claimOpenFxCompletion,
  OPEN_FX_FALLBACK_MARGIN_MS,
  openFxFallbackDelayMs,
} from '../src/game/openFxCompletion.ts'
import { planBombFx, sampleBombFx } from '../src/game/bombFx.ts'
import { planCoinFx, sampleCoinFx } from '../src/game/coinFx.ts'
import { planEmptyFx, sampleEmptyFx } from '../src/game/emptyFx.ts'

assert.equal(OPEN_FX_FALLBACK_MARGIN_MS, 100)
assert.equal(openFxFallbackDelayMs(720), 820)
assert.equal(openFxFallbackDelayMs(880), 980)
assert.equal(openFxFallbackDelayMs(600), 700)
assert.equal(openFxFallbackDelayMs(-1), 100)
assert.equal(openFxFallbackDelayMs(Number.NaN), 100)

// 1. claim: first wins, second ignored
{
  const flag = { current: false }
  let runs = 0
  const run = () => {
    if (!claimOpenFxCompletion(flag)) return
    runs += 1
  }
  run()
  run()
  run()
  assert.equal(runs, 1)
  assert.equal(flag.current, true)
}

// 2. Simulated rAF finishes first → fallback no-op
{
  const flag = { current: false }
  let completes = 0
  const completeOnce = () => {
    if (!claimOpenFxCompletion(flag)) return
    completes += 1
  }
  // rAF path
  completeOnce()
  // timeout path
  completeOnce()
  assert.equal(completes, 1)
}

// 3. Simulated timeout finishes first → late rAF no-op
{
  const flag = { current: false }
  let completes = 0
  const completeOnce = () => {
    if (!claimOpenFxCompletion(flag)) return
    completes += 1
  }
  completeOnce() // timeout
  completeOnce() // late rAF
  assert.equal(completes, 1)
}

// 4. Final samples at totalMs are finished + bagHidden for all FX kinds
{
  const coin = planCoinFx('bag-1', 2)
  const coinSample = sampleCoinFx(coin, coin.totalMs)
  assert.equal(coinSample.finished, true)
  assert.equal(coinSample.bagHidden, true)

  const bomb = planBombFx('bag-2')
  const bombSample = sampleBombFx(bomb, bomb.totalMs)
  assert.equal(bombSample.finished, true)
  assert.equal(bombSample.bagHidden, true)

  const empty = planEmptyFx('bag-3')
  const emptySample = sampleEmptyFx(empty, empty.totalMs)
  assert.equal(emptySample.finished, true)
  assert.equal(emptySample.bagHidden, true)
}

// 5. Fallback delay is strictly after each plan's totalMs (normal rAF wins in time)
{
  for (const total of [720, 960, 1180, 880, 600] as const) {
    assert.ok(openFxFallbackDelayMs(total) > total)
  }
}

console.log('verify:open-fx-fallback OK')
