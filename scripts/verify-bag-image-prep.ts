/**
 * Bag image preload / soft board gate contracts.
 * Run: npm run verify:bag-image-prep
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  BAG_IMAGE_PREP_TIMEOUT_MS,
  bagImagePrepSources,
  prepareBagImages,
  resetBagImagePrepForTests,
} from '../src/game/bagImagePrep'
import { BAG_IDS, bagSrc } from '../src/game/assets'

{
  const sources = bagImagePrepSources()
  assert.equal(sources.length, 8)
  for (let i = 0; i < 8; i += 1) {
    assert.equal(sources[i], bagSrc(BAG_IDS[i]))
    assert.match(sources[i], new RegExp(`/assets/game/bag-${i + 1}\\.webp$`))
  }
}

{
  assert.ok(BAG_IMAGE_PREP_TIMEOUT_MS > 0)
  assert.ok(BAG_IMAGE_PREP_TIMEOUT_MS <= 500)
}

{
  // Node has no HTML Image — prep must resolve and never throw.
  resetBagImagePrepForTests()
  await assert.doesNotReject(() => prepareBagImages())
  await assert.doesNotReject(() => prepareBagImages())
}

{
  // Fake Image: decode rejects — prep still resolves.
  resetBagImagePrepForTests()
  const OriginalImage = globalThis.Image
  let constructCount = 0
  // @ts-expect-error test double
  globalThis.Image = function FakeImage(this: {
    src: string
    complete: boolean
    onload: (() => void) | null
    onerror: (() => void) | null
    decode: () => Promise<void>
  }) {
    constructCount += 1
    this.src = ''
    this.complete = false
    this.onload = null
    this.onerror = null
    this.decode = () => Promise.reject(new Error('decode failed'))
    Object.defineProperty(this, 'src', {
      configurable: true,
      get: () => this._src as string,
      set: (value: string) => {
        ;(this as { _src?: string })._src = value
        this.complete = true
        queue.queueMicrotask(() => this.onload?.())
      },
    })
  }
  try {
    await assert.doesNotReject(() => prepareBagImages())
    assert.equal(constructCount, 8)
  } finally {
    globalThis.Image = OriginalImage
  }
  resetBagImagePrepForTests()
}

{
  // Singleton: two callers share one prep wave.
  resetBagImagePrepForTests()
  const OriginalImage = globalThis.Image
  let constructCount = 0
  // @ts-expect-error test double
  globalThis.Image = function FakeImage(this: {
    complete: boolean
    onload: (() => void) | null
    onerror: (() => void) | null
    decode: () => Promise<void>
  }) {
    constructCount += 1
    this.complete = true
    this.onload = null
    this.onerror = null
    this.decode = () => Promise.resolve()
    Object.defineProperty(this, 'src', {
      configurable: true,
      set: () => {
        /* already complete — loadAndDecode uses sync complete path */
      },
      get: () => 'x',
    })
  }
  try {
    await Promise.all([prepareBagImages(), prepareBagImages()])
    assert.equal(constructCount, 8, 'singleton prep should load each bag once')
  } finally {
    globalThis.Image = OriginalImage
  }
  resetBagImagePrepForTests()
}

const [prepSource, boardSource, boardCss, appSource, playScreen, optimistic] =
  await Promise.all([
    readFile('src/game/bagImagePrep.ts', 'utf8'),
    readFile('src/components/BagBoard.tsx', 'utf8'),
    readFile('src/components/BagBoard.css', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
    readFile('src/duel/duelOptimisticOpen.ts', 'utf8'),
  ])

assert.match(prepSource, /prepareBagImages/)
assert.match(prepSource, /\.decode\(/)
assert.match(prepSource, /BAG_IDS/)
assert.doesNotMatch(prepSource, /throw new/)

assert.match(boardSource, /prepareBagImages/)
assert.match(boardSource, /BAG_IMAGE_PREP_TIMEOUT_MS/)
assert.match(boardSource, /bag-board--preparing/)
assert.match(boardSource, /hiddenBagIds\?\.has\(slot\.bagId\)/)
assert.match(boardSource, /getFormation\(bagCount\)/)
assert.doesNotMatch(boardSource, /opponent-placements|getLocalOpenResult/)

assert.match(boardCss, /\.bag-board--preparing \.bag-image/)
assert.match(boardCss, /opacity:\s*0/)
assert.doesNotMatch(boardCss, /transition:\s*opacity/)
assert.doesNotMatch(boardCss, /animation-delay|nth-child/)

assert.match(appSource, /prepareBagImages\(\)/)

// Theme A / OPEN contracts untouched.
assert.match(playScreen, /getLocalOpenResult/)
assert.match(playScreen, /startPredictedOpenFx/)
assert.match(optimistic, /sameLocalAndServerOpen/)
assert.match(playScreen, /visualHiddenBagIds\(opened, coinFxSample\)/)

const opponentClient = await readFile(
  'src/duel/duelPlayCoordinator.ts',
  'utf8',
)
assert.match(opponentClient, /getOpponentPlacements/)
assert.doesNotMatch(boardSource, /getOpponentPlacements/)
assert.doesNotMatch(prepSource, /getOpponentPlacements/)

console.log('verify-bag-image-prep: all checks passed')
