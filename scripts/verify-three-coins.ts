/**
 * 3 COINS confirm SE verify (pure logic — no real audio I/O).
 * Run: npm run verify:three-coins
 */
import { BAG_OPEN_VOLUME } from '../src/game/bagAudio'
import { BOMB_POP_VOLUME } from '../src/game/bombAudio'
import { planBombFx } from '../src/game/bombFx'
import { bombSoundCueFromPlan } from '../src/game/bombSfx'
import { COIN_CHIME_VOLUME, safeRunAudio } from '../src/game/coinAudio'
import { planCoinFx } from '../src/game/coinFx'
import { createHiddenHand, type HiddenHand } from '../src/game/hand'
import {
  applyOpenBag,
  createActiveRound,
  tryCashOut,
  type RoundState,
} from '../src/game/round'
import { THREE_COINS_VOLUME } from '../src/game/threeCoinsAudio'
import {
  lastCoinCueAtMs,
  resolveThreeCoinsSeRequest,
  shouldConsumeThreeCoinsCue,
  THREE_COINS_DELAY_AFTER_LAST_CHIME_MS,
  threeCoinsCueAtMs,
} from '../src/game/threeCoinsSfx'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

/** Simulate FX-frame SE scheduling for one open that may clear. */
function simulateThreeCoinsSe(
  coinCount: 1 | 2 | 3,
  clearsRound: boolean,
  soundOn: boolean,
): number[] {
  const plan = planCoinFx('bag-2', coinCount)
  const cueAt = clearsRound ? threeCoinsCueAtMs(plan) : Number.POSITIVE_INFINITY
  let fired = false
  const times: number[] = []
  for (let t = 0; t <= plan.totalMs; t += 1) {
    const req = resolveThreeCoinsSeRequest(
      clearsRound,
      soundOn,
      fired,
      t,
      cueAt,
    )
    if (shouldConsumeThreeCoinsCue(clearsRound, fired, t, cueAt)) fired = true
    if (req.play) times.push(t)
  }
  return times
}

function openBag(
  state: RoundState,
  bagId: 'bag-1' | 'bag-2' | 'bag-3' | 'bag-4' | 'bag-5',
): RoundState {
  const r = applyOpenBag(state, bagId)
  if (!r.ok) throw new Error(`open ${bagId} failed: ${r.reason}`)
  return r.state
}

/** bag-1=×1, bag-2=×2, bag-5=bomb, rest empty */
function hand2plus1(): HiddenHand {
  return createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-2', 'bag-2'],
  })
}

/** bag-3=×3, bag-5=bomb, rest empty */
function handTriple(): HiddenHand {
  return createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-3', 'bag-3', 'bag-3'],
  })
}

/** bag-1=×1, bag-2=×1, bag-3=×1, bag-5=bomb */
function handSingles(): HiddenHand {
  return createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-2', 'bag-3'],
  })
}

{
  if (THREE_COINS_DELAY_AFTER_LAST_CHIME_MS !== 200) {
    fail(`delay ${THREE_COINS_DELAY_AFTER_LAST_CHIME_MS} expected 200`)
  } else ok('delay after last chime = 200ms')
}

{
  const p1 = planCoinFx('bag-1', 1)
  const p2 = planCoinFx('bag-1', 2)
  const p3 = planCoinFx('bag-1', 3)
  if (lastCoinCueAtMs(p1) !== p1.totalAtMs[0]) fail('×1 last cue')
  else if (lastCoinCueAtMs(p2) !== p2.totalAtMs[1]) fail('×2 last cue')
  else if (lastCoinCueAtMs(p3) !== p3.totalAtMs[2]) fail('×3 last cue')
  else if (threeCoinsCueAtMs(p1) !== lastCoinCueAtMs(p1) + 200) fail('×1 +200')
  else if (threeCoinsCueAtMs(p2) !== lastCoinCueAtMs(p2) + 200) fail('×2 +200')
  else if (threeCoinsCueAtMs(p3) !== lastCoinCueAtMs(p3) + 200) fail('×3 +200')
  else ok('cue = last coin totalAtMs + 200 (plan SoT)')
}

{
  let round = createActiveRound(handSingles())
  round = openBag(round, 'bag-1')
  if (round.phase === 'cleared' || round.provisionalCoins !== 1) {
    fail('0+1 should stay active provisional 1')
  } else if (simulateThreeCoinsSe(1, false, true).length !== 0) {
    fail('0+1 SE should be 0')
  } else ok('provisional 0 + COIN×1 → SEなし')
}

{
  let round = createActiveRound(hand2plus1())
  round = openBag(round, 'bag-2')
  if (round.phase === 'cleared' || round.provisionalCoins !== 2) {
    fail('0+2 should stay active provisional 2')
  } else if (simulateThreeCoinsSe(2, false, true).length !== 0) {
    fail('0+2 SE should be 0')
  } else ok('provisional 0 + COIN×2 → SEなし')
}

{
  let round = createActiveRound(handTriple())
  round = openBag(round, 'bag-3')
  if (round.phase !== 'cleared' || round.capturedCoins !== 3) {
    fail('0+3 should clear with captured 3')
  } else {
    const times = simulateThreeCoinsSe(3, true, true)
    const expected = threeCoinsCueAtMs(planCoinFx('bag-3', 3))
    if (times.length !== 1) fail(`0+3 SE count ${times.length}`)
    else if (times[0]! !== expected) fail(`0+3 cue ${times[0]} vs ${expected}`)
    else ok('provisional 0 + COIN×3 → SE 1回 (last chime + 200)')
  }
}

{
  let round = createActiveRound(handSingles())
  round = openBag(round, 'bag-1') // provisional 1
  round = openBag(round, 'bag-2') // +1 → provisional 2, not cleared
  if (round.phase === 'cleared' || round.provisionalCoins !== 2) {
    fail('1+1 should be provisional 2')
  } else if (simulateThreeCoinsSe(1, false, true).length !== 0) {
    fail('1+1 SE should be 0')
  } else ok('provisional 1 + COIN×1 → SEなし')
}

{
  let round = createActiveRound(hand2plus1())
  round = openBag(round, 'bag-1') // +1 → provisional 1
  if (round.provisionalCoins !== 1) fail('setup provisional 1')
  else {
    round = openBag(round, 'bag-2') // +2 → cleared
    if (round.phase !== 'cleared') fail('1+2 should clear')
    else {
      const times = simulateThreeCoinsSe(2, true, true)
      const expected = threeCoinsCueAtMs(planCoinFx('bag-2', 2))
      if (times.length !== 1 || times[0]! !== expected) {
        fail(`1+2 SE times=${times.join(',')} expected ${expected}`)
      } else ok('provisional 1 + COIN×2 → SE 1回')
    }
  }
}

{
  let round = createActiveRound(hand2plus1())
  round = openBag(round, 'bag-2') // +2
  round = openBag(round, 'bag-1') // +1 → cleared
  if (round.phase !== 'cleared') fail('2+1 should clear')
  else {
    const times = simulateThreeCoinsSe(1, true, true)
    const expected = threeCoinsCueAtMs(planCoinFx('bag-1', 1))
    if (times.length !== 1 || times[0]! !== expected) {
      fail(`2+1 SE times=${times.join(',')} expected ${expected}`)
    } else ok('provisional 2 + COIN×1 → SE 1回')
  }
}

{
  let round = createActiveRound(hand2plus1())
  const r = applyOpenBag(round, 'bag-4')
  if (!r.ok || r.state.lastReveal?.contents.kind !== 'empty') fail('EMPTY open')
  else if (simulateThreeCoinsSe(1, r.state.phase === 'cleared', true).length !== 0) {
    fail('EMPTY SE')
  } else ok('EMPTY → SEなし')
}

{
  let round = createActiveRound(hand2plus1())
  const r = applyOpenBag(round, 'bag-5')
  if (!r.ok || r.state.phase !== 'bombed') fail('BOMB open')
  else {
    const bombPlan = planBombFx('bag-5')
    const bombCue = bombSoundCueFromPlan(bombPlan)
    const three = resolveThreeCoinsSeRequest(false, true, false, bombCue.atMs, 0)
    if (three.play) fail('BOMB should not play three-coins')
    else ok('BOMB → SEなし')
  }
}

{
  let round = createActiveRound(hand2plus1())
  round = openBag(round, 'bag-1') // provisional 1
  const cash = tryCashOut(round)
  if (!cash.ok) fail('CASH OUT failed')
  else if (cash.state.phase !== 'cashed-out') fail('not cashed-out')
  else {
    const three = resolveThreeCoinsSeRequest(false, true, false, 999, 200)
    if (three.play) fail('CASH OUT should not play three-coins')
    else ok('CASH OUT → SEなし')
  }
}

{
  const times = simulateThreeCoinsSe(3, true, false)
  if (times.length !== 0) fail(`SOUND OFF cleared SE count ${times.length}`)
  else ok('SOUND OFFでcleared → SEなし')
}

{
  const plan = planCoinFx('bag-3', 3)
  const cueAt = threeCoinsCueAtMs(plan)
  let fired = false
  let plays = 0
  for (let t = 0; t <= plan.totalMs; t += 1) {
    const req = resolveThreeCoinsSeRequest(true, true, fired, t, cueAt)
    if (shouldConsumeThreeCoinsCue(true, fired, t, cueAt)) fired = true
    if (req.play) plays += 1
  }
  for (let t = cueAt; t <= plan.totalMs; t += 10) {
    if (resolveThreeCoinsSeRequest(true, true, fired, t, cueAt).play) plays += 1
  }
  if (plays !== 1) fail(`double fire plays=${plays}`)
  else ok('同じclearで二重発火しない')
}

{
  const cueAt = 240
  let fired = false
  const atCue = resolveThreeCoinsSeRequest(true, false, fired, cueAt, cueAt)
  if (shouldConsumeThreeCoinsCue(true, fired, cueAt, cueAt)) fired = true
  const later = resolveThreeCoinsSeRequest(true, true, fired, cueAt + 50, cueAt)
  if (atCue.play) fail('OFF should not play')
  else if (later.play) fail('toggle ON after consume should not play')
  else if (!fired) fail('cue should be consumed on OFF')
  else ok('SOUND OFFでもcue消費（途中ONで再発火しない）')
}

{
  let round = createActiveRound(handTriple())
  round = openBag(round, 'bag-3')
  const snap = JSON.stringify(round)
  safeRunAudio(() => {
    throw new Error('simulated three-coins audio failure')
  })
  if (JSON.stringify(round) !== snap) fail('audio failure mutated round')
  else if (round.phase !== 'cleared' || round.capturedCoins !== 3) {
    fail('cleared/captured broken after audio fail')
  } else ok('audio失敗 → phase/capturedに影響なし')
}

{
  if (THREE_COINS_VOLUME !== 0.32) fail(`three volume ${THREE_COINS_VOLUME}`)
  else if (BAG_OPEN_VOLUME !== 0.35) fail('bag volume changed')
  else if (COIN_CHIME_VOLUME !== 0.32) fail('coin volume changed')
  else if (BOMB_POP_VOLUME !== 0.36) fail('bomb volume changed')
  else ok('音量: three 0.32 / bag 0.35 / coin 0.32 / bomb 0.36')
}

{
  const early = resolveThreeCoinsSeRequest(true, true, false, 100, 240)
  const notClear = resolveThreeCoinsSeRequest(false, true, false, 300, 240)
  const done = resolveThreeCoinsSeRequest(true, true, true, 300, 240)
  if (early.play || early.reason !== 'too-early') fail('too-early')
  else if (notClear.play || notClear.reason !== 'not-cleared') fail('not-cleared')
  else if (done.play || done.reason !== 'already-fired') fail('already-fired')
  else ok('gate reasons: too-early / not-cleared / already-fired')
}

if (failures > 0) {
  console.error(`\nverify:three-coins FAILED (${failures})`)
  process.exit(1)
}
console.log('\nverify:three-coins OK')
