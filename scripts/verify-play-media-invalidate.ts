/**
 * Late / stuck media must not become audible after grace / abandon.
 * Uses a stub HTMLAudioElement — no real decode I/O.
 */
import assert from 'node:assert/strict'
import {
  __resetPlayMediaForTests,
  getPlayMediaEpoch,
  invalidatePendingMediaPlays,
  playMediaElement,
  PLAY_MEDIA_SAFETY_TIMEOUT_MS,
} from '../src/game/playMedia.ts'
import {
  __resetScreenPresentationForTests,
  abandonScreenPresentation,
  beginScreenPresentation,
  markScreenPresentationVisualDone,
  noteScreenPresentationAudio,
  waitScreenPresentationSettled,
} from '../src/game/screenPresentation.ts'

type StubAudio = HTMLAudioElement & {
  paused: boolean
  playCalls: number
  pauseCalls: number
  playImpl: () => Promise<void>
}

function createStubAudio(): StubAudio {
  const listeners = new Map<string, Set<() => void>>()
  const stub = {
    paused: true,
    volume: 1,
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    playImpl: () => Promise.resolve(),
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn)
    },
    pause() {
      stub.pauseCalls += 1
      stub.paused = true
    },
    play() {
      stub.playCalls += 1
      stub.paused = false
      return stub.playImpl()
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) ?? []) fn()
    },
  }
  return stub as unknown as StubAudio
}

__resetPlayMediaForTests()
__resetScreenPresentationForTests()

{
  const audio = createStubAudio()
  let resolvePlay!: () => void
  audio.playImpl = () =>
    new Promise<void>((resolve) => {
      resolvePlay = resolve
    })

  const playing = playMediaElement(audio, 0.36)
  assert.equal(audio.playCalls, 1)
  invalidatePendingMediaPlays()
  resolvePlay()
  await playing
  assert.ok(audio.pauseCalls >= 1, 'late play() start must be silenced after invalidate')
  assert.equal(audio.paused, true)
  console.log('OK: invalidate silences play() that resolves after abandon/grace')
}

{
  __resetPlayMediaForTests()
  const before = getPlayMediaEpoch()
  const audio = createStubAudio()
  invalidatePendingMediaPlays()
  assert.ok(getPlayMediaEpoch() > before)
  const playing = playMediaElement(audio, 0.36)
  // New play after invalidate uses fresh epoch and may proceed.
  audio.dispatch('ended')
  await playing
  assert.equal(audio.playCalls, 1)
  console.log('OK: new plays after invalidate use a fresh epoch')
}

{
  __resetPlayMediaForTests()
  __resetScreenPresentationForTests()
  const audio = createStubAudio()
  let resolvePlay!: () => void
  audio.playImpl = () =>
    new Promise<void>((resolve) => {
      resolvePlay = resolve
    })

  const gen = beginScreenPresentation()
  noteScreenPresentationAudio(gen, playMediaElement(audio, 0.36))
  markScreenPresentationVisualDone(gen)
  await waitScreenPresentationSettled(gen, 80)
  resolvePlay()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(audio.pauseCalls >= 1, 'grace path must invalidate late media')
  console.log('OK: presentation grace invalidates pending media')
}

{
  __resetPlayMediaForTests()
  __resetScreenPresentationForTests()
  const audio = createStubAudio()
  let resolvePlay!: () => void
  audio.playImpl = () =>
    new Promise<void>((resolve) => {
      resolvePlay = resolve
    })

  const gen = beginScreenPresentation()
  noteScreenPresentationAudio(gen, playMediaElement(audio, 0.36))
  abandonScreenPresentation(gen)
  resolvePlay()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(audio.pauseCalls >= 1, 'abandon must invalidate pending media')
  console.log('OK: abandon invalidates pending media')
}

{
  assert.ok(PLAY_MEDIA_SAFETY_TIMEOUT_MS >= 5_000)
  console.log('OK: per-play safety timeout remains fail-open')
}

console.log('verify:play-media-invalidate OK')
