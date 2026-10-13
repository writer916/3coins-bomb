import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertHiddenHandInvariants,
  createHiddenHandFromQuestion,
} from '../src/game/hand'
import { questionPlacementKey } from '../src/game/questionGeneration'
import { type RandomSource } from '../src/game/random'
import { SOLO_STATS_STORAGE_KEY } from '../src/game/soloStats'
import {
  createSoloQuestionSession,
  readSoloQuestionHistory,
  SOLO_QUESTION_HISTORY_KEY,
  SOLO_QUESTION_HISTORY_VERSION,
  writeSoloQuestionHistory,
  type SoloQuestionHistoryStorage,
} from '../src/game/soloQuestionHistory'

class MemoryStorage implements SoloQuestionHistoryStorage {
  readonly values = new Map<string, string>()
  reads = 0
  writes = 0
  failRead = false
  failWrite = false

  getItem(key: string): string | null {
    this.reads += 1
    if (this.failRead) throw new Error('storage denied')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes += 1
    if (this.failWrite) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
}

function seededRandom(seedValue: number): RandomSource {
  let seed = seedValue >>> 0
  return {
    next() {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

const storage = new MemoryStorage()
assert.notEqual(SOLO_QUESTION_HISTORY_KEY, SOLO_STATS_STORAGE_KEY)
const session = createSoloQuestionSession(storage, seededRandom(1))
const initial = session.getInitialQuestion()
assert.equal(session.getInitialQuestion(), initial, 'StrictMode-safe initial question cache')
assert.equal(storage.reads, 1)
assert.equal(storage.writes, 1, 'initial question is persisted exactly once')

const questions = [initial]
for (let index = 0; index < 25; index += 1) questions.push(session.nextQuestion())
for (let index = 1; index < questions.length; index += 1) {
  const currentKey = questionPlacementKey(questions[index]!)
  const previous = questions
    .slice(Math.max(0, index - 20), index)
    .map(questionPlacementKey)
  assert(!previous.includes(currentKey), `question ${index + 1} repeats recent history`)
}
assert.equal(session.getHistory().length, 20)
assert.equal(storage.writes, 26, 'storage writes occur once per generated ROUND')

const stored = JSON.parse(storage.values.get(SOLO_QUESTION_HISTORY_KEY)!) as {
  version: number
  keys: string[]
}
assert.equal(stored.version, SOLO_QUESTION_HISTORY_VERSION)
assert.deepEqual(stored.keys, session.getHistory())
assert.equal(Object.keys(stored).sort().join(','), 'keys,version')

const reloaded = createSoloQuestionSession(storage, seededRandom(2))
const priorHistory = [...session.getHistory()]
const afterReload = reloaded.getInitialQuestion()
assert(!priorHistory.includes(questionPlacementKey(afterReload)))
assert.equal(reloaded.getHistory().length, 20)

for (const corrupt of [
  '{',
  'null',
  '[]',
  JSON.stringify({ version: 2, keys: priorHistory }),
  JSON.stringify({ version: 1, keys: 'not-an-array' }),
  JSON.stringify({ version: 1, keys: [null, 1, {}, 'invalid-key'] }),
]) {
  const broken = new MemoryStorage()
  broken.values.set(SOLO_QUESTION_HISTORY_KEY, corrupt)
  assert.deepEqual(readSoloQuestionHistory(broken), [])
  assert.doesNotThrow(() => createSoloQuestionSession(broken, seededRandom(3)).getInitialQuestion())
}

const inaccessible = new MemoryStorage()
inaccessible.failRead = true
assert.doesNotThrow(() => createSoloQuestionSession(inaccessible, seededRandom(4)).getInitialQuestion())
const writeFailure = new MemoryStorage()
writeFailure.failWrite = true
const memorySession = createSoloQuestionSession(writeFailure, seededRandom(5))
for (let index = 0; index < 30; index += 1) memorySession.nextQuestion()
assert.equal(memorySession.getHistory().length, 20)
assert.equal(writeFailure.writes, 30)
assert.deepEqual(readSoloQuestionHistory(null), [])
assert.doesNotThrow(() => writeSoloQuestionHistory(priorHistory, null))

for (const question of questions) {
  assertHiddenHandInvariants(createHiddenHandFromQuestion(question))
}

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const openHandler = source.slice(source.indexOf('const handleBagTap'), source.indexOf('const handleCashOut'))
for (const forbidden of [
  'soloQuestionSession',
  'localStorage',
  'drawQuestion',
  'questionPlacementKey',
]) {
  assert(!openHandler.includes(forbidden), `OPEN path contains ${forbidden}`)
}
assert(source.includes('createInitialSoloRound()'))
assert(source.includes('createNextSoloRound()'))
assert(source.includes('hand ? createActiveRound(hand) : createNextSoloRound()'))
assert(source.includes('const handleNewRound'))
assert(source.includes('const handleReset'))
assert.equal((source.match(/beginFreshRound\(\)/g) ?? []).length >= 3, true)

const performanceStorage = new MemoryStorage()
const performanceSession = createSoloQuestionSession(performanceStorage, seededRandom(6))
const started = performance.now()
for (let index = 0; index < 1_000; index += 1) performanceSession.nextQuestion()
const elapsedMs = performance.now() - started
const readStarted = performance.now()
for (let index = 0; index < 1_000; index += 1) {
  readSoloQuestionHistory(performanceStorage)
}
const readElapsedMs = performance.now() - readStarted
const savedHistory = performanceSession.getHistory()
const writeStarted = performance.now()
for (let index = 0; index < 1_000; index += 1) {
  writeSoloQuestionHistory(savedHistory, performanceStorage)
}
const writeElapsedMs = performance.now() - writeStarted

console.log('verify:solo-question-history OK')
console.log(`performance=1000 ROUND generation+memory-storage in ${elapsedMs.toFixed(1)}ms (${(elapsedMs / 1000).toFixed(3)}ms/ROUND)`)
console.log(`history-read=1000 in ${readElapsedMs.toFixed(1)}ms (${(readElapsedMs / 1000).toFixed(3)}ms/read)`)
console.log(`history-write=1000 in ${writeElapsedMs.toFixed(1)}ms (${(writeElapsedMs / 1000).toFixed(3)}ms/write)`)
