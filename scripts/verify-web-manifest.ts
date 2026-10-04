/**
 * Web App Manifest + HTML PWA basics (install UI / SW out of scope).
 */
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'

function pngSize(buffer: Buffer): { width: number; height: number } {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

const manifestRaw = await readFile('public/manifest.webmanifest', 'utf8')
const html = await readFile('index.html', 'utf8')
const manifest = JSON.parse(manifestRaw) as Record<string, unknown>

assert.equal(manifest.name, '3 COINS BOMB')
assert.equal(manifest.short_name, '3CB')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.background_color, '#1a1510')
assert.equal(manifest.theme_color, '#1a1510')

assert.doesNotMatch(manifestRaw, /#p=|#invite=|matchId|3cb_pa1_|3cb_pi1_|3cb_pb1_|\/duel\//)
assert.ok(!('shortcuts' in manifest), 'manifest must not declare shortcuts')

const icons = manifest.icons
assert.ok(Array.isArray(icons), 'icons must be an array')
assert.equal(icons.length, 2)

const bySrc = new Map(
  (icons as Array<Record<string, unknown>>).map((icon) => [icon.src, icon]),
)
for (const [src, sizes] of [
  ['/icons/icon-192.png', '192x192'],
  ['/icons/icon-512.png', '512x512'],
] as const) {
  const icon = bySrc.get(src)
  assert.ok(icon, `missing icon ${src}`)
  assert.equal(icon.sizes, sizes)
  assert.equal(icon.type, 'image/png')
  assert.equal(icon.purpose, 'any')
}

assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/)
assert.match(
  html,
  /<link\s+rel="apple-touch-icon"\s+href="\/icons\/apple-touch-icon\.png"\s*\/?>/,
)
assert.match(html, /<meta\s+name="theme-color"\s+content="#1a1510"\s*\/?>/)
assert.match(html, /<title>3 COINS BOMB<\/title>/)
assert.doesNotMatch(html, /serviceWorker|service-worker|navigator\.serviceWorker/i)
assert.doesNotMatch(html, /beforeinstallprompt|appinstalled/)

const iconFiles = [
  ['public/icons/apple-touch-icon.png', 180],
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
] as const

for (const [path, expected] of iconFiles) {
  await access(path, fsConstants.R_OK)
  const size = pngSize(await readFile(path))
  assert.equal(size.width, expected, `${path} width`)
  assert.equal(size.height, expected, `${path} height`)
}

assert.doesNotMatch(
  manifestRaw + html,
  /金貨が舞う巾着袋/,
  'source artwork must not be referenced',
)

console.log('verify-web-manifest: all checks passed')
