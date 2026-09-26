/**
 * SOLO cumulative + ROUND-draft stats verify (pure + storage — no DOM).
 * Run: npm run verify:solo-stats
 */
import type { BagContents } from '../src/game/hand'
import {
  applyAcceptedOpenToDraft,
  calculateHitRate,
  clearSoloStatsStorage,
  commitRoundResultToStats,
  createInitialSoloRoundDraft,
  createInitialSoloStats,
  deserializeSoloStats,
  normalizeSoloStats,
  readSoloStats,
  resetSoloRoundDraft,
  resetSoloStats,
  serializeSoloStats,
  writeSoloStats,
  type SoloRoundDraft,
  type SoloStats,
} from '../src/game/soloStats'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

function eqStats(a: SoloStats, b: SoloStats): boolean {
  return (
    a.rounds === b.rounds &&
    a.capturedCoins === b.capturedCoins &&
    a.openedBags === b.openedBags &&
    a.coinBags === b.coinBags &&
    a.bombs === b.bombs
  )
}

function eqDraft(a: SoloRoundDraft, b: SoloRoundDraft): boolean {
  return (
    a.openedBags === b.openedBags &&
    a.coinBags === b.coinBags &&
    a.bombs === b.bombs
  )
}

const empty: BagContents = { kind: 'empty' }
const coin1: BagContents = { kind: 'coins', coinCount: 1 }
const coin2: BagContents = { kind: 'coins', coinCount: 2 }
const coin3: BagContents = { kind: 'coins', coinCount: 3 }
const bomb: BagContents = { kind: 'bomb' }

const ZEROS = createInitialSoloStats()
const ZERO_DRAFT = createInitialSoloRoundDraft()

{
  if (!eqStats(createInitialSoloStats(), ZEROS)) fail('initial stats')
  else ok('初期累積stats = 全0')
}

{
  if (!eqDraft(createInitialSoloRoundDraft(), ZERO_DRAFT)) fail('initial draft')
  else ok('初期ROUND仮成績 = 全0')
}

{
  const stats = createInitialSoloStats()
  const draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), empty)
  if (
    !eqStats(stats, ZEROS) ||
    draft.openedBags !== 1 ||
    draft.coinBags !== 0 ||
    draft.bombs !== 0
  ) {
    fail('EMPTY open')
  } else ok('EMPTY open → temp opened +1 / 累積不変')
}

{
  const stats = createInitialSoloStats()
  const draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin1)
  if (
    !eqStats(stats, ZEROS) ||
    draft.openedBags !== 1 ||
    draft.coinBags !== 1 ||
    draft.bombs !== 0
  ) {
    fail('COIN×1 open')
  } else ok('COIN×1 open → temp bags+1 coinBags+1 / 累積不変')
}

{
  const draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin2)
  if (draft.openedBags !== 1 || draft.coinBags !== 1) fail('COIN×2 draft')
  else ok('COIN×2 → temp coinBagsは1袋分だけ')
}

{
  const draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin3)
  if (draft.openedBags !== 1 || draft.coinBags !== 1) fail('COIN×3 draft')
  else ok('COIN×3 → temp coinBagsは1袋分だけ')
}

{
  const statsBefore = createInitialSoloStats()
  const draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), bomb)
  if (
    !eqStats(statsBefore, ZEROS) ||
    draft.openedBags !== 1 ||
    draft.bombs !== 1 ||
    draft.coinBags !== 0
  ) {
    fail('BOMB open pre-commit')
  } else ok('BOMB open → temp opened+1 bombs+1 / commit前累積不変')
}

{
  // COIN×1 → COIN×1 → EMPTY → BOMB
  let draft = createInitialSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin1)
  draft = applyAcceptedOpenToDraft(draft, coin1)
  draft = applyAcceptedOpenToDraft(draft, empty)
  draft = applyAcceptedOpenToDraft(draft, bomb)
  const c = commitRoundResultToStats(
    createInitialSoloStats(),
    draft,
    { kind: 'bombed' },
    false,
  )
  if (
    !c.ok ||
    c.stats.rounds !== 1 ||
    c.stats.capturedCoins !== 0 ||
    c.stats.openedBags !== 4 ||
    c.stats.coinBags !== 2 ||
    c.stats.bombs !== 1
  ) {
    fail('BOMB settle batch')
  } else ok('BOMB決着 → rounds+1 captured+0 + temp一括反映')
}

{
  let draft = createInitialSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin3)
  const c = commitRoundResultToStats(
    createInitialSoloStats(),
    draft,
    { kind: 'cleared' },
    false,
  )
  if (
    !c.ok ||
    c.stats.rounds !== 1 ||
    c.stats.capturedCoins !== 3 ||
    c.stats.openedBags !== 1 ||
    c.stats.coinBags !== 1 ||
    c.stats.bombs !== 0
  ) {
    fail('clear settle')
  } else ok('3 COINS決着 → rounds+1 captured+3 + temp一括反映')
}

{
  let draft = createInitialSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin1)
  draft = applyAcceptedOpenToDraft(draft, empty)
  const c = commitRoundResultToStats(
    createInitialSoloStats(),
    draft,
    { kind: 'cashed-out', capturedCoins: 1 },
    false,
  )
  if (
    !c.ok ||
    c.stats.rounds !== 1 ||
    c.stats.capturedCoins !== 1 ||
    c.stats.openedBags !== 2 ||
    c.stats.coinBags !== 1
  ) {
    fail('cash 1')
  } else ok('CASH OUT 1 → rounds+1 captured+1 + temp一括反映')
}

{
  let draft = createInitialSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin2)
  const c = commitRoundResultToStats(
    createInitialSoloStats(),
    draft,
    { kind: 'cashed-out', capturedCoins: 2 },
    false,
  )
  if (
    !c.ok ||
    c.stats.rounds !== 1 ||
    c.stats.capturedCoins !== 2 ||
    c.stats.openedBags !== 1 ||
    c.stats.coinBags !== 1
  ) {
    fail('cash 2')
  } else ok('CASH OUT 2 → rounds+1 captured+2 + temp一括反映')
}

{
  // Unsettled abandon: discard draft; cumulative untouched
  const settled: SoloStats = {
    rounds: 10,
    capturedCoins: 18,
    openedBags: 25,
    coinBags: 12,
    bombs: 3,
  }
  let draft = createInitialSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin1)
  draft = applyAcceptedOpenToDraft(draft, empty)
  draft = applyAcceptedOpenToDraft(draft, coin1)
  // abandon = drop draft, keep stats
  draft = resetSoloRoundDraft()
  if (!eqStats(settled, settled) || !eqDraft(draft, ZERO_DRAFT)) {
    fail('abandon')
  } else if (
    draft.openedBags !== 0 ||
    settled.rounds !== 10 ||
    settled.openedBags !== 25
  ) {
    fail('abandon mutated')
  } else ok('未決着ROUND途中離脱 → temp破棄でも累積完全不変')
}

{
  const settled: SoloStats = {
    rounds: 10,
    capturedCoins: 18,
    openedBags: 25,
    coinBags: 12,
    bombs: 3,
  }
  const mem: Record<string, string> = {}
  const storage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => {
      mem[k] = v
    },
    removeItem: (k: string) => {
      delete mem[k]
    },
  }
  writeSoloStats(settled, storage)
  // Mid-ROUND draft is never written
  const restored = readSoloStats(storage)
  const freshDraft = createInitialSoloRoundDraft()
  if (!eqStats(restored, settled) || !eqDraft(freshDraft, ZERO_DRAFT)) {
    fail('reload restore')
  } else ok('reload相当 → 確定累積のみ復元 / tempは復元されない')
}

{
  // REVEAL / NEXT do not call draft/commit APIs
  const stats = createInitialSoloStats()
  const draft = createInitialSoloRoundDraft()
  if (!eqStats(stats, ZEROS) || !eqDraft(draft, ZERO_DRAFT)) fail('reveal identity')
  else ok('REVEAL → 累積・tempとも不変（集計API非呼び出し）')
}

{
  let draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin1)
  const stats = createInitialSoloStats()
  // NEXT ROUND = reset draft only
  draft = resetSoloRoundDraft()
  if (!eqStats(stats, ZEROS) || !eqDraft(draft, ZERO_DRAFT)) fail('next')
  else ok('NEXT ROUND → 累積不変 / tempのみ0')
}

{
  let stats = resetSoloStats()
  let draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin1)
  draft = resetSoloRoundDraft()
  stats = resetSoloStats()
  if (!eqStats(stats, ZEROS) || !eqDraft(draft, ZERO_DRAFT)) fail('reset')
  else ok('RESET → 累積0 / temp0')
}

{
  let draft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), bomb)
  const first = commitRoundResultToStats(
    createInitialSoloStats(),
    draft,
    { kind: 'bombed' },
    false,
  )
  if (!first.ok) fail('first commit')
  else {
    const second = commitRoundResultToStats(
      first.stats,
      draft,
      { kind: 'bombed' },
      true,
    )
    if (second.ok) fail('double allowed')
    else if (!eqStats(second.stats, first.stats)) fail('double mutated')
    else ok('同じROUNDの二重commit不可')
  }
}

{
  // HIT RATE from settled only — mid draft must not affect
  const settled: SoloStats = {
    rounds: 2,
    capturedCoins: 4,
    openedBags: 10,
    coinBags: 4,
    bombs: 2,
  }
  const midDraft = applyAcceptedOpenToDraft(createInitialSoloRoundDraft(), coin1)
  if (calculateHitRate(settled) !== 0.4 || midDraft.coinBags !== 1) {
    fail('hit rate')
  } else ok('HIT RATE = 決着済みROUNDのみから算出')
}

{
  if (calculateHitRate(createInitialSoloStats()) !== null) fail('zero bags')
  else ok('openedBags=0安全処理 → null')
}

{
  if (!eqStats(deserializeSoloStats('{not json'), ZEROS)) fail('bad json')
  else if (!eqStats(deserializeSoloStats('{"v":99,"rounds":1}'), ZEROS)) {
    fail('bad version')
  } else {
    const n = normalizeSoloStats({
      rounds: 1,
      capturedCoins: 2,
      openedBags: 3,
      coinBags: 9,
      bombs: 9,
    })
    if (n.coinBags !== 3 || n.bombs !== 3) fail('clamp')
    else if (normalizeSoloStats({ rounds: -1, openedBags: 2 }).rounds !== 0) {
      fail('neg')
    } else ok('壊れたlocalStorage安全復旧')
  }
}

{
  // Post-reset play still works
  let draft = resetSoloRoundDraft()
  draft = applyAcceptedOpenToDraft(draft, coin1)
  const c = commitRoundResultToStats(
    resetSoloStats(),
    draft,
    { kind: 'cashed-out', capturedCoins: 1 },
    false,
  )
  if (!c.ok || c.stats.rounds !== 1 || c.stats.capturedCoins !== 1) {
    fail('post-reset play')
  } else ok('RESET後は新しいROUNDとして開始可能')
}

{
  const mem: Record<string, string> = {}
  const storage = {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => {
      mem[k] = v
    },
    removeItem: (k: string) => {
      delete mem[k]
    },
  }
  writeSoloStats(
    { rounds: 1, capturedCoins: 1, openedBags: 1, coinBags: 1, bombs: 0 },
    storage,
  )
  // Ensure serialized blob has no draft fields
  const raw = mem['3cb.soloStats'] ?? ''
  if (raw.includes('draft') || raw.includes('temp')) fail('draft in storage')
  clearSoloStatsStorage(storage)
  if (!eqStats(readSoloStats(storage), ZEROS)) fail('clear')
  else ok('storageは確定累積のみ / clear → initial')
}

{
  // serialize round-trip of settled only
  const s0: SoloStats = {
    rounds: 3,
    capturedCoins: 5,
    openedBags: 8,
    coinBags: 3,
    bombs: 1,
  }
  if (!eqStats(deserializeSoloStats(serializeSoloStats(s0)), s0)) fail('serde')
  else ok('serialize/deserialize 確定stats')
}

if (failures > 0) {
  console.error(`\nverify:solo-stats FAILED (${failures})`)
  process.exit(1)
}
console.log('\nverify:solo-stats OK')
