/** Client UUID v4 helper: randomUUID preferred, getRandomValues fallback. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUuid } from '../src/browser/randomUuid.ts'
import { createPendingGroupCreate } from '../src/group/groupPersistence.ts'
import { generateCreateRequestId } from '../src/duel/duelPersistence.ts'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const FIXED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

assert.equal(
  randomUuid({
    randomUUID: () => FIXED as `${string}-${string}-${string}-${string}-${string}`,
  }),
  FIXED,
)

let getRandomCalls = 0
const fromBytes = randomUuid({
  getRandomValues(array) {
    getRandomCalls += 1
    const view = array as Uint8Array
    for (let i = 0; i < view.length; i += 1) view[i] = i + 1
    return array
  },
})
assert.equal(getRandomCalls, 1)
assert.match(fromBytes, UUID_V4)

let threw = false
const afterThrow = randomUuid({
  randomUUID: () => {
    threw = true
    throw new Error('secure context required')
  },
  getRandomValues(array) {
    const view = array as Uint8Array
    view.fill(0xab)
    return array
  },
})
assert.equal(threw, true)
assert.match(afterThrow, UUID_V4)

assert.throws(() => randomUuid({}), /getRandomValues/)

const pending = createPendingGroupCreate(3, 2, {
  getRandomValues(array) {
    const view = array as Uint8Array
    view.fill(0x11)
    return array
  },
})
assert.match(pending.createRequestId, UUID_V4)

const duelId = generateCreateRequestId({
  getRandomValues(array) {
    const view = array as Uint8Array
    for (let i = 0; i < view.length; i += 1) view[i] = 0x22 + i
    return array
  },
})
assert.match(duelId, UUID_V4)

const utilSource = readFileSync(resolve('src/browser/randomUuid.ts'), 'utf8')
assert.doesNotMatch(utilSource, /Math\.random\s*\(/)
assert.match(utilSource, /getRandomValues/)
assert.match(utilSource, /randomUUID/)

const groupPersistence = readFileSync(resolve('src/group/groupPersistence.ts'), 'utf8')
assert.match(groupPersistence, /randomUuid\(/)
assert.doesNotMatch(groupPersistence, /cryptoSource\.randomUUID\(\)/)

console.log('verify:random-uuid OK')
