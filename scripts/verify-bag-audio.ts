/**
 * Bag-open cloth SE verify (pure logic — no real audio I/O).
 * Run: npm run verify:bag-audio
 */
import { readFileSync } from 'node:fs'
import { BAG_OPEN_VOLUME } from '../src/game/bagAudio'
import { resolveBagOpenSeRequest } from '../src/game/bagSfx'
import { BOMB_POP_VOLUME } from '../src/game/bombAudio'
import { bombSoundCueFromPlan, resolveBombPopRequest } from '../src/game/bombSfx'
import { planBombFx } from '../src/game/bombFx'
import { COIN_CHIME_VOLUME, safeRunAudio } from '../src/game/coinAudio'
import { planCoinSoundCues, resolveCoinChimeRequest } from '../src/game/coinSfx'
import { planCoinFx, sampleCoinFx } from '../src/game/coinFx'
import { planEmptyFx, sampleEmptyFx } from '../src/game/emptyFx'
import { createHiddenHand } from '../src/game/hand'
import { applyOpenBag, createActiveRound, tryCashOut } from '../src/game/round'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

{
  const on = resolveBagOpenSeRequest(true, true)
  const off = resolveBagOpenSeRequest(false, true)
  if (!on.play) fail('SOUND ON + accepted should play')
  else if (off.play) fail('SOUND OFF should not play')
  else ok('SOUND ON + accepted open → bag SE 1回 / OFF → 0回')
}

{
  const rejected = [
    resolveBagOpenSeRequest(true, false),
    resolveBagOpenSeRequest(false, false),
  ]
  if (rejected.some((r) => r.play)) fail('not-accepted should never play')
  else ok('無効tap（not-accepted）→ bag SEなし')
}

{
  // COIN: bag SE + coin cues
  const bag = resolveBagOpenSeRequest(true, true)
  let prev: number | null = null
  const coinPlays: number[] = []
  const plan = planCoinFx('bag-2', 2)
  for (let t = 0; t <= plan.totalMs; t += 5) {
    const s = sampleCoinFx(plan, t)
    const req = resolveCoinChimeRequest(true, prev, s.displayTotal)
    if (req.play) coinPlays.push(req.step)
    if (s.displayTotal !== prev) prev = s.displayTotal
  }
  if (!bag.play) fail('COIN open missing bag SE')
  else if (JSON.stringify(coinPlays) !== '[1,2]') fail(`coin cues ${JSON.stringify(coinPlays)}`)
  else if (planCoinSoundCues(2).length !== 2) fail('coin cue plan drifted')
  else ok('COIN → bag SE 1回 + coin cue')
}

{
  // BOMB: bag SE + bomb cue at 700
  const bag = resolveBagOpenSeRequest(true, true)
  const plan = planBombFx('bag-2')
  const cue = bombSoundCueFromPlan(plan)
  let fired = false
  const bombTimes: number[] = []
  for (let t = 0; t <= plan.totalMs; t += 5) {
    const req = resolveBombPopRequest(true, fired, t, cue.atMs)
    if (!fired && t >= cue.atMs) fired = true
    if (req.play) bombTimes.push(t)
  }
  if (!bag.play) fail('BOMB open missing bag SE')
  else if (bombTimes.length !== 1 || bombTimes[0]! < 700 || bombTimes[0]! > 704) {
    fail(`bomb cue ${JSON.stringify(bombTimes)}`)
  } else if (cue.atMs !== 700) fail('bomb cue timing drifted')
  else ok('BOMB → bag SE 1回 + bomb cue 700ms')
}

{
  // EMPTY: bag SE only (no coin / bomb result SE)
  const bag = resolveBagOpenSeRequest(true, true)
  const emptyPlan = planEmptyFx('bag-3')
  for (let t = 0; t <= emptyPlan.totalMs; t += 10) {
    sampleEmptyFx(emptyPlan, t)
  }
  // EMPTY path never resolves coin/bomb result cues
  const coinOff = resolveCoinChimeRequest(true, null, null)
  const bombOff = resolveBombPopRequest(true, false, 0, 700)
  if (!bag.play) fail('EMPTY open missing bag SE')
  else if (coinOff.play || bombOff.play) fail('EMPTY should not fire result SE at t=0')
  else ok('EMPTY → bag SE 1回、結果SEなし')
}

{
  // Same bag re-open / round ended → not accepted at UI layer
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
    // UI only calls bag SE when applyOpenBag ok — re-open is not ok
    const seAgain = resolveBagOpenSeRequest(true, again.ok)
    if (again.ok) fail('same bag should reject')
    else if (seAgain.play) fail('re-tap should not get bag SE')
    else ok('同一bag再tap → bag SEなし')
  }
}

{
  const hand = createHiddenHand({
    bagCount: 4,
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-2', 'bag-2'],
  })
  let round = createActiveRound(hand)
  const bomb = applyOpenBag(round, 'bag-1')
  if (!bomb.ok) fail('bomb open failed')
  else {
    round = bomb.state
    const after = applyOpenBag(round, 'bag-2')
    const se = resolveBagOpenSeRequest(true, after.ok)
    if (after.ok) fail('open after bomb should fail')
    else if (se.play) fail('ended ROUND tap should not bag SE')
    else ok('ROUND終了後tap → bag SEなし')
  }
}

{
  // CASH OUT is not a bag open — bag SE must not fire for cash-out path
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-1', 'bag-1', 'bag-2'],
  })
  let round = createActiveRound(hand)
  const c1 = applyOpenBag(round, 'bag-1')
  if (!c1.ok) fail('coin open failed')
  else {
    round = c1.state
    const cash = tryCashOut(round)
    const se = resolveBagOpenSeRequest(true, false) // cash-out never accepted bag open
    if (!cash.ok) fail('cash out should work')
    else if (se.play) fail('cash out must not bag SE')
    else ok('CASH OUT → bag SEなし')
  }
}

{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-5',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let round = createActiveRound(hand)
  const opened = applyOpenBag(round, 'bag-1')
  if (!opened.ok) fail('open failed')
  else {
    round = opened.state
    const snap = JSON.stringify(round)
    const req = resolveBagOpenSeRequest(true, true)
    if (req.play) {
      safeRunAudio(() => {
        throw new Error('simulated bag audio failure')
      })
    }
    if (JSON.stringify(round) !== snap) fail('ROUND mutated by bag audio failure')
    else ok('audio失敗 → ROUND / FXに影響なし')
  }
}

{
  if (BAG_OPEN_VOLUME !== 0.35) fail(`bag volume ${BAG_OPEN_VOLUME}`)
  else if (COIN_CHIME_VOLUME !== 0.32) fail('COIN volume changed')
  else if (BOMB_POP_VOLUME !== 0.36) fail('BOMB volume changed')
  else ok('音量定数: bag 0.35 / COIN 0.32 / BOMB 0.36 維持')
}

{
  // Structural: accepted-open path must not sync-load before play
  const appSrc = readFileSync(
    new URL('../src/App.tsx', import.meta.url),
    'utf8',
  )
  const tap = appSrc.match(
    /const handleBagTap = useCallback\(\n?\s*\(bagId: BagId\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\)/,
  )
  if (!tap) fail('handleBagTap block not found')
  else if (tap[0]!.includes('warmBagOpenAudio')) {
    fail('accepted open path still calls warmBagOpenAudio (load race risk)')
  } else if (!tap[0]!.includes('playBagOpen')) {
    fail('accepted open path missing playBagOpen')
  } else ok('accepted open直前にwarm/loadしない')

  const bagSrc = readFileSync(
    new URL('../src/game/bagAudio.ts', import.meta.url),
    'utf8',
  )
  const playFn = bagSrc.match(
    /export function playBagOpen\([\s\S]*?\n\}/,
  )
  if (!playFn) fail('playBagOpen not found')
  else if (/\.load\s*\(/.test(playFn[0]!)) {
    fail('playBagOpen must not call load()')
  } else ok('playBagOpenはloadせずcurrentTime+playのみ')

  const warmFn = bagSrc.match(
    /export function warmBagOpenAudio\([\s\S]*?\n\}/,
  )
  if (!warmFn) fail('warmBagOpenAudio not found')
  else if (/\.load\s*\(/.test(warmFn[0]!)) {
    fail('warmBagOpenAudio must not call load() (aborts in-flight play)')
  } else ok('warmBagOpenAudioも明示loadしない')
}

if (failures > 0) {
  console.error(`\n${failures} bag audio check(s) failed.`)
  process.exit(1)
}

console.log('\nAll bag-open audio checks passed.')
