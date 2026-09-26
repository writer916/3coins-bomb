/**
 * COIN open FX visual regression guards (vs approved a812f857 structure).
 * Run: npm run verify:coin-fx-visual
 *
 * Pure structure + depth math — does not import React components.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BAG_COUNTS,
  bagSlotDepthZIndex,
  getFormation,
} from '../src/game/formations'

let failures = 0

function fail(message: string): void {
  failures += 1
  console.error(`FAIL: ${message}`)
}

function ok(label: string): void {
  console.log(`OK: ${label}`)
}

/** Same formula as CoinOpenFx (approved a812f857). */
function coinOpenFxZIndex(formationY: number): number {
  return Math.round(formationY) + 40
}

const here = dirname(fileURLToPath(import.meta.url))
const coinFxSource = readFileSync(
  join(here, '../src/components/CoinOpenFx.tsx'),
  'utf8',
)

{
  if (!coinFxSource.includes('coin-open-fx-inner')) {
    fail('CoinOpenFx must render .coin-open-fx-inner')
  } else ok('CoinOpenFx uses coin-open-fx-inner')
}

{
  // Approved emphasize class matches CoinOpenFx.css (not --emph).
  if (!coinFxSource.includes('coin-open-fx-label--strong')) {
    fail('emphasize class must be coin-open-fx-label--strong')
  } else if (coinFxSource.includes('--emph')) {
    fail('stale --emph class still present')
  } else ok('emphasize class = coin-open-fx-label--strong')
}

{
  if (!coinFxSource.includes('Math.round(slot.y) + 40')) {
    fail('zIndex must use Math.round(slot.y) + 40')
  } else ok('zIndex formula Math.round(slot.y) + 40 present')
}

{
  // Outer style block should set zIndex; transform belongs on inner.
  const hasInnerTransform =
    coinFxSource.includes('className="coin-open-fx-inner"') &&
    coinFxSource.includes('transform: `translate(-50%, calc(-50% - ${risePx}px))`')
  if (!hasInnerTransform) {
    fail('transform must be on coin-open-fx-inner with -50% centering')
  } else ok('transform/opacity on coin-open-fx-inner (centering SoT)')
}

{
  for (const count of BAG_COUNTS) {
    const slots = getFormation(count)
    const maxBagZ = Math.max(...slots.map((s) => bagSlotDepthZIndex(s.y)))
    for (const slot of slots) {
      const coinZ = coinOpenFxZIndex(slot.y)
      const expected = Math.round(slot.y) + 40
      if (coinZ !== expected) {
        fail(`${count} ${slot.bagId}: coinZ ${coinZ} !== round(y)+40 (${expected})`)
      } else if (!(coinZ > maxBagZ)) {
        fail(
          `${count} ${slot.bagId}: coinZ ${coinZ} not above max bag z ${maxBagZ}`,
        )
      }
    }
  }
  if (failures === 0) ok('3～8袋: coin zIndex = round(y)+40 かつ全袋より手前')
}

{
  const cases: { count: (typeof BAG_COUNTS)[number]; bagId: string }[] = [
    { count: 5, bagId: 'bag-5' },
    { count: 6, bagId: 'bag-6' },
    { count: 7, bagId: 'bag-6' },
    { count: 8, bagId: 'bag-8' },
  ]
  for (const c of cases) {
    const slot = getFormation(c.count).find((s) => s.bagId === c.bagId)
    if (!slot) {
      fail(`missing ${c.count}/${c.bagId}`)
      continue
    }
    const coinZ = coinOpenFxZIndex(slot.y)
    const bagZs = getFormation(c.count).map((s) => bagSlotDepthZIndex(s.y))
    if (!(coinZ > Math.max(...bagZs))) {
      fail(`spotlight ${c.count}/${c.bagId}: coinZ ${coinZ} <= bags`)
    }
  }
  if (failures === 0) ok('前列 / bag-8 spotlight: coin above all bags')
}

if (failures > 0) {
  console.error(`\nverify:coin-fx-visual FAILED (${failures})`)
  process.exit(1)
}
console.log('\nverify:coin-fx-visual OK')
