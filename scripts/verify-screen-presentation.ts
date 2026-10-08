/**
 * Screen presentation lock: open FX + owned SFX must settle before navigation.
 * Pure / structural — no real audio I/O.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  __resetScreenPresentationForTests,
  abandonScreenPresentation,
  beginScreenPresentation,
  isScreenPresentationBlocking,
  markScreenPresentationVisualDone,
  noteScreenPresentationAudio,
  SCREEN_PRESENTATION_AUDIO_GRACE_MS,
  waitScreenPresentationSettled,
} from '../src/game/screenPresentation.ts'
import { openFxFallbackDelayMs } from '../src/game/openFxCompletion.ts'
import { planBombFx } from '../src/game/bombFx.ts'
import { planCoinFx } from '../src/game/coinFx.ts'

__resetScreenPresentationForTests()

{
  assert.equal(isScreenPresentationBlocking(), false)
  const gen = beginScreenPresentation()
  assert.equal(isScreenPresentationBlocking(), true)
  markScreenPresentationVisualDone(gen)
  assert.equal(isScreenPresentationBlocking(), false)
  console.log('OK: visual-only presentation settles immediately')
}

{
  __resetScreenPresentationForTests()
  const gen = beginScreenPresentation()
  let resolveAudio!: () => void
  const audio = new Promise<void>((resolve) => {
    resolveAudio = resolve
  })
  noteScreenPresentationAudio(gen, audio)
  markScreenPresentationVisualDone(gen)
  assert.equal(isScreenPresentationBlocking(), true)
  resolveAudio()
  await waitScreenPresentationSettled(gen, 500)
  assert.equal(isScreenPresentationBlocking(), false)
  console.log('OK: navigation waits for owned SFX after visual')
}

{
  __resetScreenPresentationForTests()
  const gen = beginScreenPresentation()
  noteScreenPresentationAudio(
    gen,
    new Promise(() => {
      /* never settles */
    }),
  )
  markScreenPresentationVisualDone(gen)
  const started = Date.now()
  await waitScreenPresentationSettled(gen, 120)
  assert.ok(Date.now() - started >= 100)
  assert.equal(isScreenPresentationBlocking(), false)
  console.log('OK: audio grace fail-open unlocks (no permanent lock)')
}

{
  __resetScreenPresentationForTests()
  const gen = beginScreenPresentation()
  abandonScreenPresentation(gen)
  assert.equal(isScreenPresentationBlocking(), false)
  await waitScreenPresentationSettled(gen, 50)
  console.log('OK: abandon clears lock (reload / mismatch recovery)')
}

{
  assert.ok(SCREEN_PRESENTATION_AUDIO_GRACE_MS >= 2_000)
  const bomb = planBombFx('bag-1')
  const coin3 = planCoinFx('bag-1', 3)
  assert.ok(SCREEN_PRESENTATION_AUDIO_GRACE_MS > openFxFallbackDelayMs(bomb.totalMs) - bomb.totalMs)
  assert.ok(SCREEN_PRESENTATION_AUDIO_GRACE_MS > 500)
  assert.ok(coin3.totalMs < 2_000)
  console.log('OK: grace exceeds normal cue lag without cutting short FX')
}

const [
  presentation,
  startOpen,
  bombFx,
  coinFx,
  emptyFx,
  app,
  duelPlay,
  groupPlay,
] = await Promise.all([
  readFile('src/game/screenPresentation.ts', 'utf8'),
  readFile('src/game/startOpenPresentation.ts', 'utf8'),
  readFile('src/components/BombOpenFx.tsx', 'utf8'),
  readFile('src/components/CoinOpenFx.tsx', 'utf8'),
  readFile('src/components/EmptyOpenFx.tsx', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/GroupPlayScreen.tsx', 'utf8'),
])

assert.match(presentation, /waitScreenPresentationSettled/)
assert.match(presentation, /invalidatePendingMediaPlays/)
assert.match(startOpen, /beginScreenPresentation/)
assert.match(startOpen, /playBagOpen/)
assert.match(bombFx, /waitScreenPresentationSettled/)
assert.match(bombFx, /noteScreenPresentationAudio/)
assert.match(coinFx, /waitScreenPresentationSettled/)
assert.match(coinFx, /playCoinChime/)
assert.match(emptyFx, /waitScreenPresentationSettled/)
assert.match(app, /startOpenPresentation/)
assert.match(app, /isScreenPresentationBlocking/)
assert.match(app, /presentationGen=\{coinFx\.presentationGen\}/)
assert.match(duelPlay, /startOpenPresentation/)
assert.match(duelPlay, /if \(fx !== null \|\| interactionLockedRef\.current\) return/)
assert.match(groupPlay, /startOpenPresentation/)
assert.match(groupPlay, /!fx/)
assert.match(groupPlay, /wantsCompletion/)

console.log('OK: SOLO / DUEL / GROUP wire presentationGen + settle before unlock')
console.log('verify:screen-presentation OK')
