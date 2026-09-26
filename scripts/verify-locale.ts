/**
 * Locale preference read/write — mirrors SOUND storage safety rules.
 */
import assert from 'node:assert/strict'
import {
  LANGUAGE_STORAGE_KEY,
  nextLocale,
  parseLocaleStored,
  readLocale,
  writeLocale,
} from '../src/game/locale.ts'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null
    },
    key() {
      return null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
  }
}

assert.equal(parseLocaleStored(null), 'en')
assert.equal(parseLocaleStored(''), 'en')
assert.equal(parseLocaleStored('en'), 'en')
assert.equal(parseLocaleStored('ja'), 'ja')
assert.equal(parseLocaleStored('JA'), 'ja')
assert.equal(parseLocaleStored('fr'), 'en')
assert.equal(parseLocaleStored('nope'), 'en')

assert.equal(nextLocale('en'), 'ja')
assert.equal(nextLocale('ja'), 'en')

const store = memoryStorage()
assert.equal(readLocale(store), 'en')
writeLocale('ja', store)
assert.equal(store.getItem(LANGUAGE_STORAGE_KEY), 'ja')
assert.equal(readLocale(store), 'ja')
writeLocale('en', store)
assert.equal(readLocale(store), 'en')

assert.equal(readLocale(null), 'en')
writeLocale('ja', null) // no throw

console.log('verify:locale OK')
