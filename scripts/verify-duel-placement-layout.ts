/** DUEL placement layout boundary checks for every fixed formation. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BAG_COUNTS, FORMATIONS, type BagCount } from '../src/game/formations'

const appCss = await readFile('src/App.css', 'utf8')
const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
const bagCss = await readFile('src/components/BagBoard.css', 'utf8')

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

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 600 },
  { width: 390, height: 667 },
  { width: 768, height: 900 },
]) {
  const short = viewport.height <= 600
  const boardHeight = short
    ? Math.min(viewport.height * 0.34, 13 * 16)
    : Math.min(viewport.height * 0.42, 17.5 * 16)
  const flowGap = (short ? 0.15 : 0.35) * 16
  const instructionTop = boardHeight + flowGap

  for (const count of BAG_COUNTS) {
    const lowestCenter = Math.max(...FORMATIONS[count].map((slot) => slot.y))
    const lowestBagBottom = boardHeight * lowestCenter / 100 +
      bagSizePx(count, viewport.width) / 2
    assert(
      lowestBagBottom < instructionTop,
      `${count} bags overlap instruction at ${viewport.width}x${viewport.height}`,
    )
  }
}

assert.match(bagCss, /\.bag-board\s*{/)
assert.match(bagCss, /\.bag-slot\s*{[^}]*position:\s*absolute/s)
assert.doesNotMatch(await readFile('src/App.tsx', 'utf8'), /duel-slot-instruction/)

console.log('verify:duel-placement-layout OK')
