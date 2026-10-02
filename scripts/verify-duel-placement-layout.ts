/** DUEL placement layout boundary checks for every fixed formation. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BAG_COUNTS, FORMATIONS, type BagCount } from '../src/game/formations'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const appCss = await readFile('src/App.css', 'utf8')
const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
const bagCss = await readFile('src/components/BagBoard.css', 'utf8')
const numsSource = await readFile('src/ui/withDuelNums.tsx', 'utf8')
const playScreen = await readFile('src/components/DuelPlayScreen.tsx', 'utf8')
const optimistic = await readFile('src/duel/duelOptimisticOpen.ts', 'utf8')

assert.doesNotMatch(
  appCss,
  /\.duel-flow--place \.duel-slot-instruction\s*{[^}]*margin-top:\s*-/s,
  'DUEL placement instruction must never be pulled into the BagBoard',
)
assert.match(
  appCss,
  /\.duel-flow--place \.duel-slot-instruction\s*{[^}]*margin-top:\s*0/s,
)
assert(
  flowSource.indexOf('className="duel-slot duel-slot-board"') <
    flowSource.indexOf('className="duel-slot duel-slot-instruction"'),
  'instruction must follow the complete board slot in document flow',
)
assert(
  flowSource.indexOf('className="duel-slot duel-slot-instruction"') <
    flowSource.indexOf('className="duel-slot duel-slot-buttons"'),
  'buttons must stay below the instruction slot',
)

// Japanese place copy: shared intentional break to avoid mid-phrase wrap.
assert.equal(ja.duelPlaceBomb, '袋をタップして\n爆弾を置いてください')
assert.equal(ja.duelPlaceCoins, '袋をタップして\n3枚のコインを置いてください')
assert.ok(ja.duelPlaceBomb.includes('\n'))
assert.ok(ja.duelPlaceCoins.includes('\n'))
assert.equal(
  ja.duelPlaceBomb.split('\n')[0],
  ja.duelPlaceCoins.split('\n')[0],
  'BOMB and COIN share the same first instruction line',
)
for (const line of [
  ...ja.duelPlaceBomb.split('\n'),
  ...ja.duelPlaceCoins.split('\n'),
]) {
  assert.ok(line.length > 0)
  assert.ok(
    line.length <= 14,
    `intentional JA place line too long for narrow panes: ${line}`,
  )
}

// English place copy unchanged (no forced JA breaks).
assert.equal(en.duelPlaceBomb, 'Tap to place the bomb.')
assert.equal(en.duelPlaceCoins, 'Tap to place 3 coins.')
assert.ok(!en.duelPlaceBomb.includes('\n'))
assert.ok(!en.duelPlaceCoins.includes('\n'))

assert.match(numsSource, /duel-instruction-line/)
assert.match(
  appCss,
  /\.duel-instruction-line\s*{[^}]*white-space:\s*nowrap/s,
  'intentional instruction lines must not mid-phrase wrap',
)
assert.match(appCss, /\.duel-instruction\s*{[^}]*line-break:\s*strict/s)
assert.match(
  appCss,
  /\.duel-flow--place\s*{[^}]*--duel-slot-instruction-h:\s*2\.9rem/s,
)
assert.match(
  appCss,
  /@media \(max-height: 600px\)[\s\S]*--duel-slot-instruction-h:\s*2\.75rem/,
)
assert.match(
  flowSource,
  /withDuelNumsAndBreaks\(placeCopy\.instruction\)/,
)

// OPEN optimistic path must stay untouched by this layout work.
assert.match(playScreen, /createOptimisticOpenGate|startPredictedOpenFx/)
assert.match(optimistic, /markOptimisticFxDone/)
assert.doesNotMatch(playScreen, /duel-instruction-line/)

const bagSizePx = (count: BagCount, width: number): number => {
  const rules: Record<BagCount, readonly [number, number, number]> = {
    3: [5.85 * 16, 0.30, 8 * 16],
    4: [5.1 * 16, 0.245, 7 * 16],
    5: [5.35 * 16, 0.275, 7.4 * 16],
    6: [4.8 * 16, 0.235, 6.6 * 16],
    7: [4.6 * 16, 0.225, 6.35 * 16],
    8: [4.45 * 16, 0.215, 6.15 * 16],
  }
  const [min, vw, max] = rules[count]
  return Math.min(max, Math.max(min, width * vw))
}

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 600 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]

for (const viewport of viewports) {
  const short = viewport.height <= 600
  const boardHeight = short
    ? Math.min(viewport.height * 0.34, 13 * 16)
    : Math.min(viewport.height * 0.42, 17.5 * 16)
  const flowGap = (short ? 0.15 : 0.35) * 16
  const instructionH = (short ? 2.75 : 2.9) * 16
  const buttonsH = 9.35 * 16
  const roundH = (short ? 1.35 : 1.55) * 16
  const instructionTop = boardHeight + flowGap
  const buttonsTop = instructionTop + instructionH + flowGap

  for (const count of BAG_COUNTS) {
    const lowestCenter = Math.max(...FORMATIONS[count].map((slot) => slot.y))
    const lowestBagBottom = boardHeight * lowestCenter / 100 +
      bagSizePx(count, viewport.width) / 2
    assert(
      lowestBagBottom < instructionTop,
      `${count} bags overlap instruction at ${viewport.width}x${viewport.height}`,
    )
    assert(
      lowestBagBottom < buttonsTop,
      `${count} bags reach button band at ${viewport.width}x${viewport.height}`,
    )
  }

  // Place stack (round + board + instruction + buttons + gaps) stays in-flow.
  const stack =
    roundH + boardHeight + instructionH + buttonsH + flowGap * 3 + 0.25 * 16
  assert(
    stack < viewport.height,
    `place stack overflows viewport ${viewport.width}x${viewport.height}: ${stack}`,
  )
}

assert.match(bagCss, /\.bag-board\s*{/)
assert.match(bagCss, /\.bag-slot\s*{[^}]*position:\s*absolute/s)
assert.doesNotMatch(await readFile('src/App.tsx', 'utf8'), /duel-slot-instruction/)

console.log('verify:duel-placement-layout OK')
