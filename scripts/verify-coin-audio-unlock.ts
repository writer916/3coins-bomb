/** COIN audio unlock single-flight / timeout regression checks. */
import assert from 'node:assert/strict'

type PendingPlay = {
  readonly resolve: () => void
  readonly reject: (reason?: unknown) => void
  readonly audio: FakeAudio
}

const created: FakeAudio[] = []
const pending: PendingPlay[] = []

class FakeAudio {
  preload = ''
  volume = 1
  currentTime = 0
  pauseCalls = 0
  loadCalls = 0

  constructor(readonly src = '') {
    created.push(this)
  }

  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject, audio: this })
    })
  }

  pause(): void {
    this.pauseCalls += 1
  }

  load(): void {
    this.loadCalls += 1
  }
}

Object.assign(globalThis, { Audio: FakeAudio })

const activeTimers = new Set<ReturnType<typeof setTimeout>>()
const nativeSetTimeout = globalThis.setTimeout
const nativeClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
  let timer: ReturnType<typeof setTimeout>
  timer = nativeSetTimeout(() => {
    activeTimers.delete(timer)
    callback()
  }, delay)
  activeTimers.add(timer)
  return timer
}) as typeof setTimeout
globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
  activeTimers.delete(timer)
  nativeClearTimeout(timer)
}) as typeof clearTimeout

try {
  const audio = await import('../src/game/coinAudio.ts?single-flight')

  for (let i = 0; i < 50; i += 1) audio.unlockCoinAudio()
  assert.equal(created.length, 4, '3 pooled elements + one silent unlock element')
  assert.equal(pending.length, 1, 'only one unlock play may be pending')
  assert.equal(activeTimers.size, 1, 'only one unlock timeout may be pending')

  await new Promise((resolve) =>
    nativeSetTimeout(resolve, audio.COIN_AUDIO_UNLOCK_TIMEOUT_MS + 50),
  )
  assert.equal(activeTimers.size, 0, 'timeout must clean its timer')
  assert.equal(pending[0]!.audio.pauseCalls, 1, 'timeout must release playback')

  audio.unlockCoinAudio()
  assert.equal(created.length, 4, 'ordinary OPEN must not retry after timeout')

  audio.unlockCoinAudio({ retry: true })
  assert.equal(created.length, 5, 'explicit SOUND-ON action may retry once')
  assert.equal(pending.length, 2)
  assert.equal(activeTimers.size, 1)

  pending[0]!.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(activeTimers.size, 1, 'old settle must not finish the new attempt')
  for (let i = 0; i < 50; i += 1) audio.unlockCoinAudio()
  assert.equal(created.length, 5, 'retry remains single-flight')

  pending[1]!.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(activeTimers.size, 0, 'successful retry must clean its timer')
  // Success warms the one-element bag and three-coins pools.
  assert.equal(created.length, 7)
  for (let i = 0; i < 50; i += 1) audio.unlockCoinAudio()
  assert.equal(created.length, 7, 'unlocked pool must not create more elements')

  const rejected = await import('../src/game/coinAudio.ts?rejected-attempt')
  const beforeRejected = created.length
  rejected.unlockCoinAudio()
  pending.at(-1)!.reject(new Error('blocked'))
  await Promise.resolve()
  await Promise.resolve()
  for (let i = 0; i < 50; i += 1) rejected.unlockCoinAudio()
  assert.equal(
    created.length - beforeRejected,
    4,
    'rejected attempt keeps legacy warmed state without duplicate probes',
  )
  assert.equal(activeTimers.size, 0)

  console.log('verify:coin-audio-unlock OK')
} finally {
  globalThis.setTimeout = nativeSetTimeout
  globalThis.clearTimeout = nativeClearTimeout
}
