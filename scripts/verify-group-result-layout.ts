/**
 * GROUP RESULT ranking layout regressions (source-level).
 * Guards independent header/row scroll, quiet-top min-width blowout,
 * bottom TOP action band, and GROUP-only detail bag field overrides.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ja, en } from '../src/i18n/index.ts'
import { FORMATIONS, type BagCount } from '../src/game/formations.ts'

const root = resolve(import.meta.dirname, '..')
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')
const boardCss = readFileSync(
  resolve(root, 'src/components/DuelMatchDetailBoard.css'),
  'utf8',
)
const bagCss = readFileSync(resolve(root, 'src/components/BagBoard.css'), 'utf8')
const screen = readFileSync(
  resolve(root, 'src/components/GroupResultScreen.tsx'),
  'utf8',
)
const detailScreen = readFileSync(
  resolve(root, 'src/components/GroupResultDetailScreen.tsx'),
  'utf8',
)

assert.match(screen, /group-result__table/)
assert.match(screen, /group-result__header/)
assert.match(screen, /group-result__ranking/)
assert.match(screen, /group-result__top/)
assert.match(screen, /title=\{entry\.nickname\}/)

/* Single vertical scroller wraps header + rows. */
const tableBlock = css.match(/\.group-result__table\s*\{[^}]*\}/)?.[0]
assert.ok(tableBlock, 'missing .group-result__table block')
assert.match(tableBlock!, /overflow-y:\s*auto/)
assert.match(tableBlock!, /flex:\s*1 1 auto/)
assert.doesNotMatch(tableBlock!, /overflow-x:\s*auto/)

const rankingBlock = css.match(/\.group-result__ranking\s*\{[^}]*\}/)?.[0]
assert.ok(rankingBlock, 'missing .group-result__ranking block')
assert.doesNotMatch(rankingBlock!, /overflow-y:\s*auto/)
assert.doesNotMatch(rankingBlock!, /scrollbar-gutter/)

const shellBlock = css.match(/\.group-result\s*\{[^}]*\}/)?.[0]
assert.ok(shellBlock, 'missing .group-result block')
assert.match(shellBlock!, /height:\s*calc\(100dvh - 5\.5rem\)/)
assert.match(shellBlock!, /--group-result-row-inline-pad/)

assert.match(css, /--group-result-cols:[\s\S]*?8em/)
assert.match(css, /\.group-result__cols > \*\s*\{[\s\S]*?min-width:\s*0/)
assert.match(
  css,
  /\.group-result__cols\s*\{[\s\S]*?padding-inline:\s*var\(--group-result-row-inline-pad\)/,
)
assert.match(
  css,
  /\.group-result \.group-result__details\.duel-btn--quiet-top\s*\{[\s\S]*?min-width:\s*0/,
)
assert.match(
  css,
  /\.group-result \.group-result__details\.duel-btn--quiet-top\s*\{[\s\S]*?width:\s*85%[\s\S]*?height:\s*1\.32rem[\s\S]*?justify-self:\s*center/,
)
assert.match(css, /\.group-result__nickname[\s\S]*?text-overflow:\s*ellipsis/)
assert.match(css, /\.group-result__top\s*\{[\s\S]*?flex:\s*0 0 auto/)
assert.match(
  css,
  /\.group-result \.group-result__top\.duel-btn--quiet-top\s*\{[\s\S]*?margin-top:\s*0\.7rem/,
)
assert.match(
  css,
  /\.group-result__top\s*\{[\s\S]*?safe-area-inset-bottom/,
)

/* DUEL / GROUP detail field shares one scoped geometry source. */
assert.match(
  boardCss,
  /\.duel-match-detail-board \.bag-board\s*\{[\s\S]*?aspect-ratio:\s*7\s*\/\s*6[\s\S]*?max-height:\s*min\(52vw,\s*17rem\)/,
)
assert.match(
  boardCss,
  /@media \(max-width:\s*360px\)[\s\S]*?aspect-ratio:\s*8\s*\/\s*7[\s\S]*?max-height:\s*min\(56vw,\s*15\.5rem\)/,
)
assert.doesNotMatch(
  css,
  /\.group-result-detail \.duel-match-detail-board \.bag-board/,
)
assert.match(
  css,
  /\.group-result-detail__rounds\s*\{[\s\S]*?overflow-y:\s*auto/,
)
assert.doesNotMatch(
  css,
  /\.group-result-detail__round\s*\{[^}]*overflow-y:\s*auto/,
)
assert.match(bagCss, /aspect-ratio:\s*4\s*\/\s*5/)
assert.match(
  css,
  /\.group-result-detail__round-stats\s*\{[\s\S]*?display:\s*flex[\s\S]*?justify-content:\s*center/,
)
assert.match(
  css,
  /\.group-result-detail__round-stats p\s*\{[\s\S]*?flex-direction:\s*row[\s\S]*?white-space:\s*nowrap/,
)
assert.match(
  detailScreen,
  /groupCapturedCoins[\s\S]*?round\.capturedCoins[\s\S]*?groupOpenedBags[\s\S]*?round\.openedBagCount/,
)

assert.equal(ja.groupViewDetails, '詳細')
assert.equal(en.groupViewDetails, 'VIEW DETAILS')
assert.ok(ja.groupViewDetails.length <= 2)

/*
  Rough fit at 320px / 16px root:
  shell pad + row inline pad + rank + nick + action + 5 gaps
  should leave measurable room for three metric fr tracks.
*/
const rootPx = 16
const width = 320
const shellPad = 0.35 * rootPx * 2
const rowPad = 0.28 * rootPx * 2
const fixed = 1.15 * rootPx + 8 * rootPx + 2.85 * rootPx
const gaps = 0.2 * rootPx * 5
const remaining = width - shellPad - rowPad - fixed - gaps
assert.ok(
  remaining > 40,
  `320px remaining for metrics too small: ${remaining.toFixed(1)}px`,
)

for (const w of [360, 375, 390]) {
  const rem = w - shellPad - rowPad - fixed - gaps
  assert.ok(rem > remaining - 1, `${w}px should not be tighter than 320`)
}

/* The 85% action leaves visible inline clearance inside its grid track. */
for (const actionTrackRem of [2.55, 2.85]) {
  const actionTrack = actionTrackRem * rootPx
  const button = actionTrack * 0.85
  assert.ok((actionTrack - button) / 2 >= 3, 'details button edge clearance')
}

/*
  Geometry check: GROUP detail board 7/6 field must keep bag bodies + OPEN
  markers within ~board height (overflow:visible is backup, not the plan).
  Marker offset matches DuelMatchDetailBoard.css (--duel-detail-open-offset).
*/
const detailBagSizeCss: Record<BagCount, string> = {
  3: 'clamp(4.35rem, 27vw, 5.6rem)',
  4: 'clamp(3.9rem, 23vw, 5.1rem)',
  5: 'clamp(4rem, 24.5vw, 5.25rem)',
  6: 'clamp(3.7rem, 21.5vw, 4.85rem)',
  7: 'clamp(3.55rem, 20.5vw, 4.7rem)',
  8: 'clamp(3.4rem, 19.5vw, 4.55rem)',
}

function resolveClamp(expr: string, vwPx: number, remPx: number): number {
  const m = expr.match(
    /clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/,
  )
  assert.ok(m, `bad clamp: ${expr}`)
  const min = Number(m![1]) * remPx
  const pref = (Number(m![2]) / 100) * vwPx
  const max = Number(m![3]) * remPx
  return Math.min(max, Math.max(min, pref))
}

for (const viewport of [320, 360, 375, 390, 768]) {
  const boardWidth = Math.min(viewport * 0.92, 20 * rootPx)
  const boardHeight = Math.min(boardWidth * (6 / 7), (52 / 100) * viewport, 17 * rootPx)
  for (const count of [3, 4, 5, 6, 7, 8] as const) {
    const bagSize = resolveClamp(detailBagSizeCss[count], viewport, rootPx)
    const markerOffset = bagSize * 0.62
    const markerHalf = Math.max(bagSize * 0.14, 0.5 * rootPx)
    const halfBag = bagSize / 2
    for (const slot of FORMATIONS[count]) {
      const cy = (slot.y / 100) * boardHeight
      const bagTop = cy - halfBag
      const bagBottom = cy + halfBag
      const aboveTop = cy - markerOffset - markerHalf
      const belowBottom = cy + markerOffset + markerHalf
      assert.ok(
        bagTop > -bagSize * 0.15,
        `${count}-bag @${viewport}: bag top clipped (${bagTop.toFixed(1)})`,
      )
      assert.ok(
        bagBottom < boardHeight + bagSize * 0.15,
        `${count}-bag @${viewport}: bag bottom clipped`,
      )
      /* Markers may slightly spill; keep within ~18% of bag-size beyond board. */
      const spill = bagSize * 0.18
      assert.ok(
        aboveTop > -spill,
        `${count}-bag @${viewport}: above marker spill ${aboveTop.toFixed(1)}`,
      )
      assert.ok(
        belowBottom < boardHeight + spill,
        `${count}-bag @${viewport}: below marker spill`,
      )
    }
  }
}

console.log('verify:group-result-layout OK')
