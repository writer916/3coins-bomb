/**
 * COIN chime scheduling verify (pure logic — no real audio I/O).
 * Run: npm run verify:audio
 */
import { sampleCoinFx, planCoinFx } from '../src/game/coinFx'
import {
  coinSoundCuesFromPlan,
  planCoinSoundCues,
  resolveCoinChimeRequest,
  soundStepForDisplayAdvance,
} from '../src/game/coinSfx'
import { safeRunAudio } from '../src/game/coinAudio'
import { createHiddenHand } from '../src/game/hand'
import { applyOpenBag, createActiveRound } from '../src/game/round'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function simulateFires(coinCount: 1 | 2 | 3, soundOn: boolean): number[] {
  const plan = planCoinFx('bag-2', coinCount)
  let prev: number | null = null
  const steps: number[] = []
  for (let t = 0; t <= plan.totalMs; t += 5) {
    const s = sampleCoinFx(plan, t)
    const req = resolveCoinChimeRequest(soundOn, prev, s.displayTotal)
    if (req.play) steps.push(req.step)
    if (s.displayTotal !== prev) prev = s.displayTotal
  }
  return steps
}

// ×1 → 1 cue at +1 time
{
  const cues = planCoinSoundCues(1)
  const plan = planCoinFx('bag-2', 1)
  if (cues.length !== 1) fail(`×1 cue count ${cues.length}`)
  else if (cues[0]!.step !== 1 || cues[0]!.atMs !== plan.totalAtMs[0]) {
    fail('×1 cue timing mismatch')
  } else ok('COIN×1 → sound cue 1回 (+1 sync)')
}

// ×2 → 2 cues
{
  const cues = planCoinSoundCues(2)
  const plan = planCoinFx('bag-2', 2)
  if (cues.length !== 2) fail(`×2 cue count ${cues.length}`)
  else if (
    cues[0]!.step !== 1 ||
    cues[1]!.step !== 2 ||
    cues[0]!.atMs !== plan.totalAtMs[0] ||
    cues[1]!.atMs !== plan.totalAtMs[1]
  ) {
    fail('×2 cue timing mismatch')
  } else ok('COIN×2 → sound cue 2回 (+1/+2 sync)')
}

// ×3 → 3 cues
{
  const cues = planCoinSoundCues(3)
  const plan = planCoinFx('bag-2', 3)
  if (cues.length !== 3) fail(`×3 cue count ${cues.length}`)
  else if (
    cues.map((c) => c.step).join(',') !== '1,2,3' ||
    cues[0]!.atMs !== plan.totalAtMs[0] ||
    cues[1]!.atMs !== plan.totalAtMs[1] ||
    cues[2]!.atMs !== plan.totalAtMs[2]
  ) {
    fail('×3 cue timing mismatch')
  } else ok('COIN×3 → sound cue 3回 (+1/+2/+3 sync)')
}

// cues come from same plan (no separate tempo)
{
  const plan = planCoinFx('bag-5', 3)
  const fromPlan = coinSoundCuesFromPlan(plan)
  const standalone = planCoinSoundCues(3)
  if (
    fromPlan.length !== standalone.length ||
    fromPlan.some((c, i) => c.atMs !== standalone[i]!.atMs)
  ) {
    fail('plan vs standalone cue mismatch')
  } else ok('cues match visual totalAtMs (no separate tempo)')
}

// display advance → step
{
  if (soundStepForDisplayAdvance(null, 1) !== 1) fail('null→1')
  else if (soundStepForDisplayAdvance(1, 2) !== 2) fail('1→2')
  else if (soundStepForDisplayAdvance(2, 3) !== 3) fail('2→3')
  else if (soundStepForDisplayAdvance(1, 1) !== null) fail('no re-fire')
  else if (soundStepForDisplayAdvance(null, null) !== null) fail('null')
  else ok('display advance maps to sound steps')
}

// SOUND OFF → no play request
{
  const off1 = resolveCoinChimeRequest(false, null, 1)
  const off2 = resolveCoinChimeRequest(false, 1, 2)
  const on = resolveCoinChimeRequest(true, null, 1)
  if (off1.play || off2.play) fail('SOUND OFF should not play')
  else if (!on.play || on.step !== 1) fail('SOUND ON should play step 1')
  else ok('SOUND OFF → no playback request; ON → play')
}

// Timeline simulation
{
  const s1 = simulateFires(1, true)
  const s2 = simulateFires(2, true)
  const s3 = simulateFires(3, true)
  const s3off = simulateFires(3, false)

  if (JSON.stringify(s1) !== '[1]') fail(`sim ×1 ${JSON.stringify(s1)}`)
  else if (JSON.stringify(s2) !== '[1,2]') fail(`sim ×2 ${JSON.stringify(s2)}`)
  else if (JSON.stringify(s3) !== '[1,2,3]') fail(`sim ×3 ${JSON.stringify(s3)}`)
  else if (s3off.length !== 0) fail('sim OFF should be empty')
  else ok('timeline simulation: cues match +1/+2/+3; OFF silent')
}

// audio failure must not affect ROUND
{
  const hand = createHiddenHand({
    bagCount: 5,
    bombBagId: 'bag-1',
    coinTargets: ['bag-2', 'bag-3', 'bag-4'],
  })
  let round = createActiveRound(hand)
  safeRunAudio(() => {
    throw new Error('audio boom')
  })
  const opened = applyOpenBag(round, 'bag-2')
  if (!opened.ok || opened.state.provisionalCoins !== 1) {
    fail('ROUND affected by audio failure')
  } else {
    round = opened.state
    ok('audio failure does not affect ROUND state')
  }
}

// animation timings unchanged (guardrails)
{
  const a = planCoinFx('bag-1', 1)
  const b = planCoinFx('bag-1', 2)
  const c = planCoinFx('bag-1', 3)
  if (a.totalMs !== 720 || b.totalMs !== 960 || c.totalMs !== 1180) {
    fail('COIN FX totalMs changed')
  } else if (
    JSON.stringify(a.totalAtMs) !== '[40]' ||
    JSON.stringify(b.totalAtMs) !== '[40,320]' ||
    JSON.stringify(c.totalAtMs) !== '[40,300,560]'
  ) {
    fail('COIN FX totalAtMs changed')
  } else ok('COIN animation timings unchanged')
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log('\nAll COIN audio scheduling checks passed.')
