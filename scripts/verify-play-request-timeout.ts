import assert from 'node:assert/strict'
import {
  fetchWithTimeout,
  PlayRequestTimeoutError,
  PLAY_REQUEST_TIMEOUT_MS,
} from '../src/game/fetchWithTimeout.ts'

assert.equal(PLAY_REQUEST_TIMEOUT_MS, 12_000)

let aborted = false
const neverSettles = (_input: RequestInfo | URL, init?: RequestInit) => {
  init?.signal?.addEventListener('abort', () => { aborted = true })
  return new Promise<Response>(() => undefined)
}
await assert.rejects(
  () => fetchWithTimeout(neverSettles as typeof fetch, '/timeout', {}, 10),
  PlayRequestTimeoutError,
)
assert.equal(aborted, true)

const response = await fetchWithTimeout(
  (async () => Response.json({ ok: true })) as typeof fetch,
  '/success',
  {},
  50,
)
assert.deepEqual(await response.json(), { ok: true })

console.log('verify:play-request-timeout OK')
