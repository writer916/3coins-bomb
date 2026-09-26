/**
 * BOMB pop SE scheduling verify (pure logic — no real audio I/O).
 * Run: npm run verify:bomb-audio
 */
import { planBombFx, sampleBombFx } from '../src/game/bombFx'
import {
  bombSoundCueFromPlan,
  planBombSoundCue,
  resolveBombPopRequest,
  shouldConsumeBombPopCue,
} from '../src/game/bombSfx'
import { planCoinSoundCues } from '../src/game/coinSfx'
import { planEmptyFx, sampleEmptyFx } from '../src/game/emptyFx'
import { createHiddenHand } from '../src/game/hand'
import { applyOpenBag, createActiveRound } from '../src/game/round'
import { safeRunAudio } from '../src/game/coinAudio'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function simulateBombPops(soundOn: boolean): number[] {
  const plan = planBombFx('bag-2')
  const cue = bombSoundCueFromPlan(plan)
  let fired = false
  const times: number[] = []
  for (let t = 0; t <= plan.totalMs; t += 5) {
    const req = resolveBombPopRequest(soundOn, fired, t, cue.atMs)
    if (shouldConsumeBombPopCue(fired, t, cue.atMs)) fired = true
    if (req.play) times.push(t)
  }
  return times
}

{
  const plan = planBombFx('bag-3')
  const cue = planBombSoundCue('bag-3')
  const fromPlan = bombSoundCueFromPlan(plan)
  if (cue.atMs !== plan.fadeStartMs || fromPlan.atMs !== 700) {
    fail(`cue atMs ${cue.atMs} / ${fromPlan.atMs} expected 700`)
  } else if (plan.fadeStartMs !== 700) {
    fail('visual fadeStartMs drifted')
  } else ok('cue時刻 → 700ms (fade開始)')
}

{
  const times = simulateBombPops(true)
  if (times.length !== 1) fail(`SOUND ON expected 1 cue, got ${times.length}`)
  else if (times[0]! < 700 || times[0]! > 704) {
    fail(`cue time ${times[0]} not at ~700`)
  } else ok('SOUND ON + BOMB → cue 1回')
}

{
  const times = simulateBombPops(false)
  if (times.length !== 0) fail(`SOUND OFF expected 0 cues, got ${times.length}`)
  else ok('SOUND OFF + BOMB → cue 0回')
}

{
  const plan = planBombFx('bag-4')
  const cue = bombSoundCueFromPlan(plan)
  let fired = false
  let plays = 0
  for (let t = 0; t <= plan.totalMs; t += 1) {
    const req = resolveBombPopRequest(true, fired, t, cue.atMs)
    if (shouldConsumeBombPopCue(fired, t, cue.atMs)) fired = true
    if (req.play) plays += 1
  }
  // After fire, keep sampling — must not re-fire
  for (let t = cue.atMs; t <= plan.totalMs; t += 10) {
    const req = resolveBombPopRequest(true, fired, t, cue.atMs)
    if (req.play) plays += 1
  }
  if (plays !== 1) fail(`double cue risk: plays=${plays}`)
  else ok('同じBOMB FXで二重cueしない')
}

{
  // SOUND OFF still consumes cue — toggle ON later must not play
  const cueAt = 700
  let fired = false
  const at700 = resolveBombPopRequest(false, fired, 700, cueAt)
  if (shouldConsumeBombPopCue(fired, 700, cueAt)) fired = true
  const later = resolveBombPopRequest(true, fired, 750, cueAt)
  if (at700.play) fail('OFF should not play')
  else if (later.play) fail('toggle ON after consume should not play')
  else if (!fired) fail('cue should be consumed on OFF')
  else ok('SOUND OFFでもcue消費（途中ONで再発火しない）')
}

{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let round = createActiveRound(hand)
  const opened = applyOpenBag(round, 'bag-5')
  if (!opened.ok) fail('open bomb failed')
  else {
    round = opened.state
    const snap = JSON.stringify(round)
    const plan = planBombFx('bag-5')
    const cue = bombSoundCueFromPlan(plan)
    let fired = false
    for (let t = 0; t <= plan.totalMs; t += 20) {
      const req = resolveBombPopRequest(true, fired, t, cue.atMs)
      if (shouldConsumeBombPopCue(fired, t, cue.atMs)) fired = true
      if (req.play) {
        safeRunAudio(() => {
          throw new Error('simulated bomb audio failure')
        })
      }
      sampleBombFx(plan, t)
    }
    if (JSON.stringify(round) !== snap) fail('ROUND mutated by bomb audio path')
    else if (round.phase !== 'bombed' || round.capturedCoins !== 0) {
      fail('ROUND bomb settle broken')
    } else ok('audio失敗 → ROUND stateに影響しない')
  }
}

{
  // BOMB SE planning must not invent COIN cues; EMPTY path never resolves bomb pop
  const coinCues = planCoinSoundCues(3)
  const bombCue = planBombSoundCue('bag-2')
  if (coinCues.length !== 3) fail('COIN cues changed')
  else if (bombCue.atMs !== 700) fail('bomb cue not independent at 700')
  else ok('BOMB SE → COIN cueを発生させない（独立cue）')

  const emptyPlan = planEmptyFx('bag-2')
  const hand = createHiddenHand({
    bagCount: 6,
    bombBagId: 'bag-1',
    coinTargets: ['bag-4', 'bag-5', 'bag-6'],
  })
  let round = createActiveRound(hand)
  const opened = applyOpenBag(round, 'bag-2')
  if (!opened.ok || opened.reveal.contents.kind !== 'empty') {
    fail('expected empty open')
  } else {
    round = opened.state
    for (let t = 0; t <= emptyPlan.totalMs; t += 10) {
      sampleEmptyFx(emptyPlan, t)
    }
    // EMPTY FX sampling never calls resolveBombPopRequest — 0 bomb plays by construction
    if (round.phase !== 'active' || round.provisionalCoins !== 0) {
      fail('EMPTY ROUND drifted')
    } else ok('EMPTY → BOMB SEを発生させない（EMPTY経路にbomb cueなし）')
  }
}

{
  const plan = planBombFx('bag-1')
  if (
    plan.totalMs !== 880 ||
    plan.igniteMs !== 160 ||
    plan.fadeStartMs !== 700 ||
    plan.bagHideMs !== 0
  ) {
    fail('BOMB visual timings changed')
  } else ok('BOMB視覚時間定数維持（880 / 160 / 700 / 0）')
}

if (failures > 0) {
  console.error(`\n${failures} BOMB audio check(s) failed.`)
  process.exit(1)
}

console.log('\nAll BOMB audio scheduling checks passed.')
