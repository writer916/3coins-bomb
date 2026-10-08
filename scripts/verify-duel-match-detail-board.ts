/**
 * Phase-2: one-ROUND read-only DUEL match detail board contracts.
 * No production debug route — pure model + source/CSS geometry checks.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildDuelMatchDetailOpenMarkers,
  coinCountsByBagFromNumbers,
  frontRowYThreshold,
  openOrderMarkerSideForBag,
  openOrderSidesForBagCount,
} from '../src/game/duelMatchDetailBoardModel'
import { BAG_COUNTS, FORMATIONS, type BagCount } from '../src/game/formations'

const boardSource = await readFile('src/components/DuelMatchDetailBoard.tsx', 'utf8')
const boardCss = await readFile('src/components/DuelMatchDetailBoard.css', 'utf8')
const bagBoardSource = await readFile('src/components/BagBoard.tsx', 'utf8')
const bagBoardCss = await readFile('src/components/BagBoard.css', 'utf8')
const placementOverlay = await readFile('src/components/DuelPlacementOverlay.tsx', 'utf8')
const modelSource = await readFile('src/game/duelMatchDetailBoardModel.ts', 'utf8')
const appSource = await readFile('src/App.tsx', 'utf8')
const flowSource = await readFile('src/components/DuelFlow.tsx', 'utf8')
const playSource = await readFile('src/components/DuelPlayScreen.tsx', 'utf8')
const resultSource = await readFile('src/components/DuelResultScreen.tsx', 'utf8')

/* Component wiring: BagBoard(read-only) + PlacementOverlay + open markers */
assert.match(boardSource, /export function DuelMatchDetailBoard/)
assert.match(boardSource, /<BagBoard bagCount=\{bagCount\} interactive=\{false\}>/)
assert.match(boardSource, /<DuelPlacementOverlay/)
assert.match(boardSource, /bombBagId=\{bombBagId\}/)
assert.match(boardSource, /coinCountsByBag=\{coinCountsByBag\}/)
assert.match(boardSource, /buildDuelMatchDetailOpenMarkers/)
assert.match(boardSource, /duel-detail-open-marker--above/)
assert.match(boardSource, /duel-detail-open-marker--below/)
assert.match(boardSource, /data-open-order=\{marker\.openOrder\}/)
assert.match(boardSource, /data-bag-number=\{marker\.bagNumber\}/)
assert.match(boardSource, /data-open-side=\{marker\.side\}/)
assert.match(boardSource, /\{marker\.openOrder\}/)
assert.doesNotMatch(boardSource, /①|②|③/)

/* ⑳ read-only / no DETAIL page wiring yet */
assert.doesNotMatch(boardSource, /onBagTap|hiddenBagIds|fetch\(|openBag|vibrate|Audio/)
assert.doesNotMatch(appSource, /DuelMatchDetailBoard/)
assert.doesNotMatch(flowSource, /DuelMatchDetailBoard/)
assert.doesNotMatch(playSource, /DuelMatchDetailBoard/)
/* RESULT hosts DETAIL via DuelMatchDetailScreen (phase 3); board stays unused here. */
assert.doesNotMatch(resultSource, /DuelMatchDetailBoard/)
assert.match(resultSource, /DuelMatchDetailScreen|duelViewDetails|fetchDetail/)
assert.match(bagBoardSource, /interactive = true/)
assert.match(bagBoardSource, /interactive \? \(/)
assert.match(flowSource, /<BagBoard bagCount=\{draft\.bagCount\} onBagTap=\{onBagTap\}>/)
assert.match(placementOverlay, /export function DuelPlacementOverlay/)
assert.match(modelSource, /frontRowYThreshold/)
assert.match(modelSource, /bagCount <= 4/)

/* Placement BagBoard sizes unchanged; detail sizes are scoped */
assert.match(
  bagBoardCss,
  /\.bag-board\[data-bag-count='3'\]\s*\{[^}]*--bag-size:\s*clamp\(5\.85rem/s,
)
assert.match(
  bagBoardCss,
  /\.bag-board\[data-bag-count='8'\]\s*\{[^}]*--bag-size:\s*clamp\(4\.45rem/s,
)
assert.match(boardCss, /\.duel-match-detail-board \.bag-board\[data-bag-count='3'\]/)
assert.match(boardCss, /\.duel-match-detail-board \.bag-board\[data-bag-count='8'\]/)
assert.match(
  boardCss,
  /\.duel-match-detail-board \.bag-board\s*\{[\s\S]*?aspect-ratio:\s*7\s*\/\s*6[\s\S]*?max-height:\s*min\(52vw,\s*17rem\)/,
)
assert.match(
  boardCss,
  /@media \(max-width:\s*360px\)[\s\S]*?aspect-ratio:\s*8\s*\/\s*7[\s\S]*?max-height:\s*min\(56vw,\s*15\.5rem\)/,
)
assert.match(boardCss, /duel-detail-open-marker--above/)
assert.match(boardCss, /duel-detail-open-marker--below/)
assert.match(boardCss, /--duel-detail-open-offset:\s*calc\(var\(--bag-size\) \* 0\.62\)/)
assert.match(boardCss, /pointer-events:\s*none/)
assert.doesNotMatch(boardCss, /①|②|③/)

/* ①–⑥ formation coverage + ⑮–⑱ above/below rules */
for (const count of BAG_COUNTS) {
  const sides = openOrderSidesForBagCount(count)
  const slots = FORMATIONS[count]
  assert.equal(Object.keys(sides).length, count)
  if (count <= 4) {
    for (const slot of slots) {
      assert.equal(sides[slot.bagId], 'above', `${count}:${slot.bagId} must be above`)
    }
    continue
  }
  const threshold = frontRowYThreshold(slots)
  let above = 0
  let below = 0
  for (const slot of slots) {
    const side = openOrderMarkerSideForBag(count, slot.bagId)
    if (slot.y >= threshold) {
      assert.equal(side, 'below', `${count}:${slot.bagId} front → below`)
      below += 1
    } else {
      assert.equal(side, 'above', `${count}:${slot.bagId} back → above`)
      above += 1
    }
  }
  assert.ok(above >= 2, `${count}: back row markers`)
  assert.ok(below >= 2, `${count}: front row markers`)
}

assert.deepEqual(openOrderSidesForBagCount(3), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above',
})
assert.deepEqual(openOrderSidesForBagCount(4), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above', 'bag-4': 'above',
})
assert.deepEqual(openOrderSidesForBagCount(5), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above',
  'bag-4': 'below', 'bag-5': 'below',
})
assert.deepEqual(openOrderSidesForBagCount(6), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above', 'bag-4': 'above',
  'bag-5': 'below', 'bag-6': 'below',
})
assert.deepEqual(openOrderSidesForBagCount(7), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above', 'bag-4': 'above',
  'bag-5': 'below', 'bag-6': 'below', 'bag-7': 'below',
})
assert.deepEqual(openOrderSidesForBagCount(8), {
  'bag-1': 'above', 'bag-2': 'above', 'bag-3': 'above', 'bag-4': 'above',
  'bag-5': 'below', 'bag-6': 'below', 'bag-7': 'below', 'bag-8': 'below',
})

/* ⑨ coin tallies incl. stacked */
assert.deepEqual(coinCountsByBagFromNumbers([1, 1, 1]), { 'bag-1': 3 })
assert.deepEqual(coinCountsByBagFromNumbers([1, 2, 3]), {
  'bag-1': 1, 'bag-2': 1, 'bag-3': 1,
})
assert.deepEqual(coinCountsByBagFromNumbers([2, 2, 4]), {
  'bag-2': 2, 'bag-4': 1,
})

/* Per-count marker fixtures: ⑦⑩⑪⑫⑬⑭⑲ */
const fixtures: Record<
  BagCount,
  {
    bomb: number
    coins: readonly number[]
    opens: readonly { openOrder: number; bagNumber: number }[]
    expectSides: Readonly<Record<number, 'above' | 'below'>>
    unopened: readonly number[]
  }
> = {
  3: {
    bomb: 3,
    coins: [1, 1, 2],
    opens: [
      { openOrder: 1, bagNumber: 1 },
      { openOrder: 2, bagNumber: 2 },
    ],
    expectSides: { 1: 'above', 2: 'above' },
    unopened: [3],
  },
  4: {
    bomb: 4,
    coins: [1, 2, 3],
    opens: [
      { openOrder: 1, bagNumber: 2 },
      { openOrder: 2, bagNumber: 4 },
    ],
    expectSides: { 2: 'above', 4: 'above' },
    unopened: [1, 3],
  },
  5: {
    bomb: 5,
    coins: [1, 1, 1],
    opens: [
      { openOrder: 1, bagNumber: 1 },
      { openOrder: 2, bagNumber: 4 },
    ],
    expectSides: { 1: 'above', 4: 'below' },
    unopened: [2, 3, 5],
  },
  6: {
    bomb: 6,
    coins: [1, 2, 4],
    opens: [
      { openOrder: 1, bagNumber: 5 },
      { openOrder: 2, bagNumber: 2 },
      { openOrder: 3, bagNumber: 6 },
    ],
    expectSides: { 5: 'below', 2: 'above', 6: 'below' },
    unopened: [1, 3, 4],
  },
  7: {
    bomb: 7,
    coins: [1, 3, 5],
    opens: [
      { openOrder: 1, bagNumber: 6 },
      { openOrder: 2, bagNumber: 1 },
    ],
    expectSides: { 6: 'below', 1: 'above' },
    unopened: [2, 3, 4, 5, 7],
  },
  8: {
    bomb: 8,
    coins: [2, 2, 3],
    opens: [
      { openOrder: 1, bagNumber: 3 },
      { openOrder: 2, bagNumber: 1 },
      { openOrder: 3, bagNumber: 5 },
      { openOrder: 4, bagNumber: 8 },
      { openOrder: 5, bagNumber: 2 },
      { openOrder: 6, bagNumber: 6 },
      { openOrder: 7, bagNumber: 4 },
      { openOrder: 8, bagNumber: 7 },
    ],
    expectSides: {
      3: 'above',
      1: 'above',
      5: 'below',
      8: 'below',
      2: 'above',
      6: 'below',
      4: 'above',
      7: 'below',
    },
    unopened: [],
  },
}

for (const count of BAG_COUNTS) {
  const fixture = fixtures[count]
  const markers = buildDuelMatchDetailOpenMarkers(count, fixture.opens)
  assert.equal(markers.length, fixture.opens.length)
  assert.equal(FORMATIONS[count].length, count, `${count}: all bag slots exist`)

  const opened = new Set(fixture.opens.map((open) => open.bagNumber))
  for (const bagNumber of fixture.unopened) {
    assert.ok(!opened.has(bagNumber), `${count}: bag ${bagNumber} should be unopened`)
  }
  for (let bagNumber = 1; bagNumber <= count; bagNumber += 1) {
    assert.ok(
      FORMATIONS[count].some((slot) => slot.bagId === `bag-${bagNumber}`),
      `${count}: formation always includes bag-${bagNumber}`,
    )
  }

  for (const [index, open] of fixture.opens.entries()) {
    const marker = markers[index]
    assert.ok(marker)
    assert.equal(marker.openOrder, open.openOrder)
    assert.equal(marker.bagNumber, open.bagNumber)
    assert.equal(marker.side, fixture.expectSides[open.bagNumber])
    assert.equal(marker.bagId, `bag-${open.bagNumber}`)
  }

  const coins = coinCountsByBagFromNumbers(fixture.coins)
  const bombId = `bag-${fixture.bomb}`
  assert.equal(coins[bombId as keyof typeof coins], undefined, 'bomb bag has no coins')
  const coinTotal = Object.values(coins).reduce((sum, n) => sum + (n ?? 0), 0)
  assert.equal(coinTotal, 3)
}

/* Responsive detail geometry: bags + markers stay inside and clear content. */
const rem = 16
const detailBagSizePx = (count: BagCount, viewportW: number): number => {
  const rules: Record<BagCount, readonly [number, number, number]> = {
    3: [4.35 * rem, 0.27, 5.6 * rem],
    4: [3.9 * rem, 0.23, 5.1 * rem],
    5: [4 * rem, 0.245, 5.25 * rem],
    6: [3.7 * rem, 0.215, 4.85 * rem],
    7: [3.55 * rem, 0.205, 4.7 * rem],
    8: [3.4 * rem, 0.195, 4.55 * rem],
  }
  const [min, vw, max] = rules[count]
  return Math.min(max, Math.max(min, viewportW * vw))
}

const markerOffsetFrac = 0.62
const markerSizeFrac = 0.28
const bombSizeFrac = 0.52
const coinSizeFrac = 0.22
const coinStackFrac = 0.1

for (const viewportW of [320, 360, 375, 390, 768, 1280]) {
  /* DUEL shell is narrower than GROUP; test the smaller effective width. */
  const boardWidth = Math.min(viewportW - 1.3 * rem, 20 * rem)
  const narrow = viewportW <= 360
  const ratioHeight = boardWidth * (narrow ? 7 / 8 : 6 / 7)
  const maxHeight = Math.min(
    (narrow ? 56 : 52) / 100 * viewportW,
    (narrow ? 15.5 : 17) * rem,
  )
  const boardHeight = Math.min(ratioHeight, maxHeight)
  const legacyHeight = boardWidth * (5 / 4)
  assert(boardHeight < legacyHeight * 0.75, `${viewportW}: detail height not compact`)

  for (const count of BAG_COUNTS) {
    const bagSize = detailBagSizePx(count, viewportW)
    assert(
      bagSize >= 3.2 * rem,
      `${count}@${viewportW}: detail bag too small (${bagSize})`,
    )
    for (const slot of FORMATIONS[count]) {
      const cx = (boardWidth * slot.x) / 100
      const cy = (boardHeight * slot.y) / 100
      const half = bagSize / 2
      assert(cx - half > -8, `${count}@${viewportW}:${slot.bagId} left overflow`)
      assert(cx + half < boardWidth + 8, `${count}@${viewportW}:${slot.bagId} right overflow`)
      assert(cy - half > -8, `${count}@${viewportW}:${slot.bagId} top overflow`)
      assert(cy + half < boardHeight + 8, `${count}@${viewportW}:${slot.bagId} bottom overflow`)

      const side = openOrderMarkerSideForBag(count, slot.bagId)
      const markerY = side === 'above'
        ? cy - bagSize * markerOffsetFrac
        : cy + bagSize * markerOffsetFrac
      const markerR = Math.max(rem / 2, (bagSize * markerSizeFrac) / 2)
      assert(markerY - markerR > 0, `${count}@${viewportW}:${slot.bagId} marker top clip`)
      assert(
        markerY + markerR < boardHeight,
        `${count}@${viewportW}:${slot.bagId} marker bottom clip`,
      )
      const contentR =
        bagSize * Math.max(bombSizeFrac, coinSizeFrac + coinStackFrac) * 0.5
      const gap = Math.abs(markerY - cy) - markerR - contentR
      assert(
        gap > 2,
        `${count}@${viewportW}:${slot.bagId} marker/content gap ${gap}`,
      )
    }
  }
}

console.log('verify:duel-match-detail-board OK')
