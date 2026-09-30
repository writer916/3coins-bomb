/**
 * COIN open FX + SOUND preference verify (pure logic).
 * Run: npm run verify:fx
 */
import {
  cumulativeCoinTotals,
  planCoinFx,
  sampleCoinFx,
  visualHiddenBagIds,
} from '../src/game/coinFx'
import {
  DEFAULT_SOUND_ENABLED,
  parseSoundStored,
  readSoundEnabled,
  SOUND_STORAGE_KEY,
  writeSoundEnabled,
} from '../src/game/sound'
import type { BagId } from '../src/game/assets'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function displaySequence(coinCount: 1 | 2 | 3): number[] {
  const plan = planCoinFx('bag-2', coinCount)
  const seen: number[] = []
  for (let t = 0; t <= plan.totalMs; t += 10) {
    const s = sampleCoinFx(plan, t)
    if (s.displayTotal !== null && seen[seen.length - 1] !== s.displayTotal) {
      seen.push(s.displayTotal)
    }
  }
  return seen
}

// --- Cumulative labels ---
{
  if (JSON.stringify(cumulativeCoinTotals(1)) !== '[1]') fail('×1 totals')
  else if (JSON.stringify(cumulativeCoinTotals(2)) !== '[1,2]') fail('×2 totals')
  else if (JSON.stringify(cumulativeCoinTotals(3)) !== '[1,2,3]') fail('×3 totals')
  else ok('cumulative totals +1 / +1→+2 / +1→+2→+3')
}

{
  const seq = displaySequence(1)
  if (JSON.stringify(seq) !== '[1]') fail(`×1 display seq ${JSON.stringify(seq)}`)
  else ok('COIN×1 → display +1')
}

{
  const seq = displaySequence(2)
  if (JSON.stringify(seq) !== '[1,2]') fail(`×2 display seq ${JSON.stringify(seq)}`)
  else ok('COIN×2 → +1 → +2')
}

{
  const seq = displaySequence(3)
  if (JSON.stringify(seq) !== '[1,2,3]') fail(`×3 display seq ${JSON.stringify(seq)}`)
  else ok('COIN×3 → +1 → +2 → +3')
}

{
  const seq = displaySequence(3)
  const bad = seq.every((n) => n === 1) && seq.length === 3
  if (bad) fail('looks like +1 +1 +1')
  else ok('not +1 +1 +1 style')
}

// --- bagId / origin isolation ---
{
  const a = planCoinFx('bag-4' as BagId, 2)
  const b = planCoinFx('bag-7' as BagId, 3)
  const sa = sampleCoinFx(a, 200)
  const sb = sampleCoinFx(b, 200)
  if (sa.bagId !== 'bag-4' || sb.bagId !== 'bag-7') fail('bagId mixed')
  else if (a.bagId === b.bagId) fail('plans share bagId')
  else ok('bagId / origin not mixed across plans')
}

// --- clear after finish ---
{
  const plan = planCoinFx('bag-2', 2)
  const mid = sampleCoinFx(plan, 400)
  const end = sampleCoinFx(plan, plan.totalMs)
  const after = sampleCoinFx(plan, plan.totalMs + 50)
  if (!mid.displayTotal || mid.finished) fail('mid should be active')
  else if (!end.finished || end.displayTotal !== null) fail('end not cleared')
  else if (!after.finished || after.displayTotal !== null) fail('after not cleared')
  else ok('FX state clears after finish')
}

// --- visual hide helper ---
{
  const opened = new Set<BagId>(['bag-2', 'bag-5'])
  for (const coinCount of [1, 2, 3] as const) {
    const plan = planCoinFx('bag-2', coinCount)
    const early = sampleCoinFx(plan, plan.bagHideMs - 1)
    const atBoundary = sampleCoinFx(plan, plan.bagHideMs)
    const earlyHidden = visualHiddenBagIds(opened, early)
    const boundaryHidden = visualHiddenBagIds(opened, atBoundary)
    if (plan.bagHideMs !== 140) fail(`COIN x${coinCount} bagHideMs changed`)
    else if (earlyHidden.has('bag-2')) fail(`COIN x${coinCount} bag hid too early`)
    else if (!earlyHidden.has('bag-5')) fail('other opened bags stay hidden')
    else if (!boundaryHidden.has('bag-2')) fail(`COIN x${coinCount} bag did not hide at boundary`)
    else ok(`COIN x${coinCount} bag hide timing via visualHiddenBagIds`)
  }
}

// --- ROUND state untouched (structural: sample returns new object, no hand) ---
{
  const plan = planCoinFx('bag-3', 1)
  const frozen = JSON.stringify(plan)
  sampleCoinFx(plan, 100)
  sampleCoinFx(plan, plan.totalMs)
  if (JSON.stringify(plan) !== frozen) fail('plan mutated')
  else ok('FX sampling does not mutate plan / ROUND')
}

// --- SOUND ---
{
  if (DEFAULT_SOUND_ENABLED !== true) fail('default should be ON')
  else if (parseSoundStored(null) !== true) fail('null → ON')
  else if (parseSoundStored('true') !== true) fail('true')
  else if (parseSoundStored('false') !== false) fail('false')
  else if (parseSoundStored('garbage') !== true) fail('invalid → ON')
  else if (parseSoundStored('') !== true) fail('empty → ON')
  else ok('SOUND parse: default ON, invalid safe')
}

{
  const mem = new Map<string, string>()
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
  }
  if (readSoundEnabled(storage) !== true) fail('empty storage → ON')
  writeSoundEnabled(false, storage)
  if (mem.get(SOUND_STORAGE_KEY) !== 'false') fail('write OFF')
  if (readSoundEnabled(storage) !== false) fail('read OFF')
  writeSoundEnabled(true, storage)
  if (readSoundEnabled(storage) !== true) fail('read ON again')
  else ok('SOUND OFF/ON persist via storage')
}

{
  // storage throws — must not crash
  const bad = {
    getItem: (): string => {
      throw new Error('denied')
    },
    setItem: (): void => {
      throw new Error('denied')
    },
  }
  try {
    if (readSoundEnabled(bad) !== true) fail('throwing get → default ON')
    writeSoundEnabled(false, bad)
    ok('SOUND storage errors do not break game')
  } catch (e) {
    fail(`storage error escaped: ${String(e)}`)
  }
}

{
  if (readSoundEnabled(null) !== true) fail('null storage')
  writeSoundEnabled(false, null)
  ok('SOUND null storage safe')
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}

console.log('\nAll COIN FX / SOUND checks passed.')
