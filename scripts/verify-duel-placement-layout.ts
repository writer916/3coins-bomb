/** DUEL setup/place shared button-field + placement geometry checks. */
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
assert(
  flowSource.indexOf('className="duel-slot duel-slot-board"') <
    flowSource.indexOf('duel-slot-instruction'),
  'instruction must follow the complete board slot in document flow',
)
assert(
  flowSource.indexOf('duel-slot-instruction') <
    flowSource.indexOf('duel-slot-buttons'),
  'buttons must stay below the instruction slot',
)

// Shared button field class on both setup and place docks.
assert.match(flowSource, /duel-btn-area duel-button-field/)
assert.match(flowSource, /duel-slot-buttons duel-button-field/)

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

// Shared button field: same reserved height + bottom inset for setup and place.
assert.match(
  appCss,
  /\.duel-flow--setup,\s*\.duel-flow--place\s*{[^}]*--duel-button-field-h:\s*9\.35rem/s,
  'setup+place must share --duel-button-field-h',
)
assert.match(
  appCss,
  /\.duel-flow--setup,\s*\.duel-flow--place\s*{[^}]*--duel-button-field-bottom:/s,
  'setup+place must share --duel-button-field-bottom',
)
assert.match(
  appCss,
  /\.duel-flow--setup > \.duel-setup-spacer--bottom,\s*\.duel-flow--place > \.duel-setup-spacer--bottom\s*{[^}]*var\(--duel-button-field-bottom\)/s,
  'bottom spacer must use shared button-field bottom inset',
)
assert.match(
  appCss,
  /\.duel-flow--setup > \.duel-setup-spacer--mid,\s*\.duel-flow--place > \.duel-setup-spacer--mid\s*{[^}]*flex:\s*1 1 auto/s,
  'mid spacer must flex-grow so content height does not move the button field',
)
assert.match(
  appCss,
  /\.duel-button-field,\s*\.duel-flow--setup \.duel-btn-area,\s*\.duel-flow--place \.duel-slot-buttons\s*{[^}]*var\(--duel-button-field-h\)/s,
  'button field height must be reserved via shared variable',
)
assert.match(
  appCss,
  /\.duel-flow--place \.duel-slot-instruction\s*{[^}]*justify-content:\s*flex-end/s,
  'place instruction must bottom-align so EN/JA share last-line edge',
)

// Forbidden: old asymmetric docks / per-screen magic that shift first-button Y.
assert.doesNotMatch(appCss, /14\.74vh/)
assert.doesNotMatch(appCss, /--duel-place-block-gap/)
assert.doesNotMatch(
  appCss,
  /\.duel-flow--place \.duel-slot-buttons\s*{[^}]*margin-top:\s*var\(--duel-place-block-gap\)/s,
)
assert.doesNotMatch(
  appCss,
  /\.duel-flow--place \.duel-slot-instruction\s*{[^}]*justify-content:\s*flex-start/s,
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

const rem = 16
const buttonFieldH = 9.35 * rem
const btnH = 2.75 * rem
const btnGap = 0.55 * rem

for (const viewport of viewports) {
  const short = viewport.height <= 600
  const roomy = viewport.width >= 768 && viewport.height >= 700
  const boardHeight = short
    ? Math.min(viewport.height * 0.34, 13 * rem)
    : Math.min(viewport.height * 0.42, 17.5 * rem)
  const boardInstructionGap = (short ? 0.25 : roomy ? 0.45 : 0.35) * rem
  const instructionH = (short ? 2.75 : 2.9) * rem
  const roundH = (short ? 1.35 : 1.55) * rem
  const boardMarginTop = 0.406 * rem
  const fieldBottom = (short ? 0.35 : 0.5) * rem
  const padBottom = (short ? 0.5 : 0.65) * rem
  const padTop = 0.25 * rem

  // Shared dock model: first button top is pinned from the flow bottom.
  // Same for ROUND NEXT / BAG SET / place RESET within one viewport.
  const flowBottomPad = padBottom + fieldBottom
  const firstButtonTopFromFlowBottom = buttonFieldH + flowBottomPad
  assert.equal(
    firstButtonTopFromFlowBottom,
    buttonFieldH + fieldBottom + padBottom,
    `viewport ${viewport.width}x${viewport.height}: dock formula must be shared`,
  )

  // 3-button stack fits inside reserved field.
  const threeBtnStack = 3 * btnH + 2 * btnGap
  assert.equal(threeBtnStack, buttonFieldH)

  const instructionTop =
    padTop + roundH + boardMarginTop + boardHeight + boardInstructionGap
  const midMin = short ? 0.45 * rem : roomy ? 1.0 * rem : 0.75 * rem

  // Content above field + min mid + field + bottom must fit.
  const minStack =
    padTop +
    roundH +
    boardMarginTop +
    boardHeight +
    boardInstructionGap +
    instructionH +
    midMin +
    buttonFieldH +
    fieldBottom +
    padBottom
  assert(
    minStack < viewport.height + 0.5 * rem,
    `place min stack overflows viewport ${viewport.width}x${viewport.height}: ${minStack}`,
  )

  // Board must not overlap instruction; instruction stays above button field.
  for (const count of BAG_COUNTS) {
    const lowestCenter = Math.max(...FORMATIONS[count].map((slot) => slot.y))
    const lowestBagBottom =
      boardHeight * (lowestCenter / 100) + bagSizePx(count, viewport.width) / 2
    assert(
      lowestBagBottom < boardHeight + boardInstructionGap,
      `${count} bags overlap instruction slot at ${viewport.width}x${viewport.height}`,
    )
    assert(
      instructionTop + instructionH + midMin <=
        viewport.height - firstButtonTopFromFlowBottom + padTop + 1,
      `${count} bags: instruction must clear button field at ${viewport.width}x${viewport.height}`,
    )
  }

  // Bag+instruction stay a tight group (not roomy block-gap between them).
  assert(
    boardInstructionGap <= 0.75 * rem,
    `board→instruction gap too large at ${viewport.width}x${viewport.height}`,
  )
}

assert.match(bagCss, /\.bag-board\s*{/)
assert.match(bagCss, /\.bag-slot\s*{[^}]*position:\s*absolute/s)
assert.doesNotMatch(await readFile('src/App.tsx', 'utf8'), /duel-slot-instruction/)

console.log('verify:duel-placement-layout OK')
