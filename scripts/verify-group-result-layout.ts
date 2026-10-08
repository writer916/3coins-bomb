/**
 * GROUP RESULT ranking layout regressions (source-level).
 * Guards independent header/row scroll and quiet-top min-width blowout.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ja, en } from '../src/i18n/index.ts'

const root = resolve(import.meta.dirname, '..')
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')
const screen = readFileSync(
  resolve(root, 'src/components/GroupResultScreen.tsx'),
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
assert.doesNotMatch(tableBlock!, /overflow-x:\s*auto/)

const rankingBlock = css.match(/\.group-result__ranking\s*\{[^}]*\}/)?.[0]
assert.ok(rankingBlock, 'missing .group-result__ranking block')
assert.doesNotMatch(rankingBlock!, /overflow-y:\s*auto/)
assert.doesNotMatch(rankingBlock!, /scrollbar-gutter/)

assert.match(css, /--group-result-cols:[\s\S]*?8em/)
assert.match(css, /\.group-result__cols > \*\s*\{[\s\S]*?min-width:\s*0/)
assert.match(
  css,
  /\.group-result \.group-result__details\.duel-btn--quiet-top\s*\{[\s\S]*?min-width:\s*0/,
)
assert.match(css, /\.group-result__nickname[\s\S]*?text-overflow:\s*ellipsis/)
assert.match(css, /\.group-result__top\s*\{[\s\S]*?flex:\s*0 0 auto/)

assert.equal(ja.groupViewDetails, '詳細')
assert.equal(en.groupViewDetails, 'VIEW DETAILS')
assert.ok(ja.groupViewDetails.length <= 2)

/*
  Rough fit at 320px / 16px root:
  padding 0.35rem×2 + rank 1.15rem + nick 8em + action 2.85rem + 5 gaps
  should leave measurable room for three metric fr tracks.
*/
const rootPx = 16
const width = 320
const padding = 0.35 * rootPx * 2
const fixed = 1.15 * rootPx + 8 * rootPx + 2.85 * rootPx
const gaps = 0.2 * rootPx * 5
const remaining = width - padding - fixed - gaps
assert.ok(
  remaining > 48,
  `320px remaining for metrics too small: ${remaining.toFixed(1)}px`,
)

for (const w of [360, 375, 390]) {
  const rem = w - padding - fixed - gaps
  assert.ok(rem > remaining - 1, `${w}px should not be tighter than 320`)
}

console.log('verify:group-result-layout OK')
