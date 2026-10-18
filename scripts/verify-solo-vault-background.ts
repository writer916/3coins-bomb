/**
 * SOLO play vault backdrop: asset + SOLO-only CSS/markup wiring.
 * Run: npx tsx scripts/verify-solo-vault-background.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const webpPath = resolve(root, 'public/solo/3cb-solo-vault-background.webp')
const webpStat = statSync(webpPath)
assert.ok(webpStat.size > 40_000, `webp too small: ${webpStat.size}`)
assert.ok(webpStat.size < 400_000, `webp too large: ${webpStat.size}`)
const webp = readFileSync(webpPath)
assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF')
assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP')

const appTsx = read('src/App.tsx')
const css = read('src/App.css')

assert.match(appTsx, /className="app app--solo"/)
assert.equal(
  [...appTsx.matchAll(/className="app app--solo"/g)].length,
  1,
  'exactly one SOLO shell',
)
assert.doesNotMatch(appTsx, /app--solo[\s\S]{0,80}app--duel/)
assert.doesNotMatch(
  appTsx,
  /app--daily-play[\s\S]{0,120}3cb-solo-vault|3cb-solo-vault[\s\S]{0,120}app--daily/,
)

assert.match(css, /\.app--solo\s*\{/)
assert.match(css, /\.app--solo::before\s*\{/)
assert.match(css, /url\('\/solo\/3cb-solo-vault-background\.webp'\)/)
assert.match(css, /pointer-events:\s*none/)
assert.match(css, /background-size:\s*cover/)
assert.match(css, /background-repeat:\s*no-repeat/)
assert.match(css, /background-color:\s*#1a1510/)
assert.doesNotMatch(css, /backdrop-filter/)
assert.doesNotMatch(css, /\.app--duel::before[\s\S]{0,200}solo-vault/)
assert.doesNotMatch(css, /\.app--daily[\s\S]{0,80}::before[\s\S]{0,200}solo-vault/)
assert.doesNotMatch(css, /\.app--top::before[\s\S]{0,200}solo-vault/)

assert.match(
  css,
  /\.app--solo \.field-bag\s*\{[^}]*margin-top:\s*40px/s,
)
assert.doesNotMatch(css, /\.app--solo \.field-bag\s*\{[^}]*transform:/s)
assert.doesNotMatch(css, /\.app--duel \.field-bag\s*\{[^}]*margin-top:\s*40px/s)
assert.doesNotMatch(
  css,
  /\.app--daily-play[\s\S]{0,80}\.field-bag\s*\{[^}]*margin-top:\s*40px/s,
)

// No React <img> remount surface for the vault (CSS ::before only).
assert.doesNotMatch(appTsx, /3cb-solo-vault-background/)

console.log('verify:solo-vault-background OK')
console.log(
  `webp bytes=${webpStat.size} path=public/solo/3cb-solo-vault-background.webp`,
)
