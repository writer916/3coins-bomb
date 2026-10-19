/**
 * Shared vault backdrop for bag-field screens + SOLO 40px board offset.
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
const groupPlay = read('src/components/GroupPlayScreen.tsx')

assert.match(appTsx, /className="app app--solo app--vault"/)
assert.match(appTsx, /app--daily-play app--vault/)
assert.equal(
  [...appTsx.matchAll(/className="app app--solo app--vault"/g)].length,
  1,
  'exactly one SOLO vault shell',
)

assert.match(css, /\.app--vault/)
assert.match(css, /\.app--duel:has\(\.duel-flow--place\)/)
assert.match(css, /\.app--duel:has\(\.duel-play\)/)
assert.match(css, /\.app--group-entry:has\(\.duel-play\)/)
assert.match(css, /url\('\/solo\/3cb-solo-vault-background\.webp'\)/)
assert.match(css, /pointer-events:\s*none/)
assert.match(css, /background-size:\s*cover/)
assert.match(css, /background-repeat:\s*no-repeat/)
assert.match(css, /background-color:\s*#1a1510/)
assert.doesNotMatch(css, /backdrop-filter/)

assert.match(
  css,
  /:is\([\s\S]*?\.field-bag[\s\S]*?\.duel-slot-board[\s\S]*?\.duel-play-board[\s\S]*?\.daily-play__board[\s\S]*?\)[\s\S]*?margin-top:\s*40px/s,
)
assert.doesNotMatch(css, /\.app--solo \.field-bag\s*\{[^}]*transform:/s)
assert.doesNotMatch(
  css,
  /\.duel-flow--place \.duel-slot-board\s*\{[^}]*margin-top:\s*0\.406rem/s,
)
assert.doesNotMatch(
  css,
  /\.app--daily-play \.daily-play__board\s*\{[^}]*margin-top:\s*clamp\(-/s,
)

assert.doesNotMatch(css, /\.app--top::before[\s\S]{0,200}solo-vault/)
assert.doesNotMatch(css, /\.app--daily-prestart[\s\S]{0,120}solo-vault/)
assert.doesNotMatch(css, /\.app--daily-result[\s\S]{0,120}solo-vault/)
assert.doesNotMatch(appTsx, /app--daily-prestart app--vault|app--daily-result app--vault/)
assert.doesNotMatch(appTsx, /app--group-create app--vault/)

assert.match(groupPlay, /duel-play-board/)
assert.doesNotMatch(appTsx, /3cb-solo-vault-background/)

/* Stone-wall setup shells (DUEL + GROUP pre-play + DAILY prestart); not PLAY. */
const stoneWallAsset = /url\('\/duel\/3cb-duel-stone-wall-background\.webp'\)/
assert.match(css, stoneWallAsset)
assert.equal(
  [...css.matchAll(new RegExp(stoneWallAsset.source, 'g'))].length,
  1,
  'stone-wall asset referenced once',
)
assert.match(css, /\.app--group-create/)
assert.match(css, /\.app--group-entry/)
assert.match(css, /\.app--daily-prestart/)
assert.match(css, /\.app--duel-mode/)
assert.match(css, /:not\(\.group-completion-waiting\)/)
assert.match(css, /\.app--group-entry:has\(\.duel-play\)/)
assert.doesNotMatch(
  css,
  /\.app--group-entry:has\(\.duel-play\)[\s\S]{0,200}3cb-duel-stone-wall/,
)
assert.doesNotMatch(
  css,
  /\.app--daily-play[\s\S]{0,200}3cb-duel-stone-wall/,
)

const stonePath = resolve(root, 'public/duel/3cb-duel-stone-wall-background.webp')
const stoneStat = statSync(stonePath)
assert.ok(stoneStat.size > 40_000, `stone webp too small: ${stoneStat.size}`)
const stone = readFileSync(stonePath)
assert.equal(stone.subarray(0, 4).toString('ascii'), 'RIFF')
assert.equal(stone.subarray(8, 12).toString('ascii'), 'WEBP')

console.log('verify:solo-vault-background OK')
console.log(
  `webp bytes=${webpStat.size} path=public/solo/3cb-solo-vault-background.webp`,
)
console.log(
  `stone-wall bytes=${stoneStat.size} path=public/duel/3cb-duel-stone-wall-background.webp`,
)
