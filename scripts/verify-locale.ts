/**
 * Locale preference + JA/EN copy guards for mode / DUEL command polish.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'
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

// --- JA copy (mode names / commands) ---
assert.equal(ja.modeSoloName, 'SOLO')
assert.equal(ja.modeSoloDesc, '袋に隠されたコイン3枚を探す')
assert.equal(ja.modeDuelName, 'DUEL')
assert.equal(ja.modeDuelDesc, '互いにコインを隠して探す2人対戦')
assert.equal(ja.modeGroupName, 'GROUP')
assert.equal(ja.modeGroupDesc, '同じ出題を解いてスコアを競う')
assert.equal(ja.cashOut, 'CASH OUT')
assert.equal(ja.duelContinue, 'NEXT')
assert.equal(ja.duelTop, 'TOP')
assert.equal(ja.duelSet, 'SET')
assert.equal(ja.duelBack, 'BACK')
assert.equal(ja.duelResetRound, 'RESET')
assert.equal(ja.duelNextRound, 'NEXT ROUND')
assert.equal(ja.duelComplete, 'OK！')
assert.equal(ja.duelLock, 'OK！')
assert.ok(!ja.duelComplete.includes('OK!'))
assert.ok(!ja.duelLock.includes('OK!'))
assert.ok(ja.duelComplete.endsWith('！'))
assert.ok(ja.duelLock.endsWith('！'))
assert.equal(ja.duelStartOver, 'RESET ALL')
assert.equal(
  ja.duelPlaceCoins,
  '袋をタップして3枚のコインを\n置いてください',
)
assert.ok(ja.duelPlaceCoins.includes('\n'))
assert.equal(ja.duelRoundsReady(5), '5 ROUND READY')
assert.equal(ja.duelRoundsReady(3), '3 ROUND READY')
assert.equal(ja.duelRoundsReady(10), '10 ROUND READY')
assert.ok(ja.duelRoundsReady(5).includes(' ROUND '))
assert.ok(!ja.modeDuelName.includes('2人対戦'))

// --- EN: unchanged ---
assert.equal(en.modeSoloName, 'SOLO')
assert.equal(en.modeSoloDesc, 'Play against hidden hands')
assert.equal(en.modeDuelName, 'DUEL')
assert.equal(en.modeDuelDesc, 'Hide & steal — 1 vs 1')
assert.equal(en.modeGroupName, 'GROUP')
assert.equal(en.modeGroupDesc, 'Same hands — highest score wins')
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(en.duelContinue, 'CONTINUE')
assert.equal(en.duelTop, 'TOP')
assert.equal(en.duelSet, 'SET')
assert.equal(en.duelBack, 'BACK')
assert.equal(en.duelResetRound, 'RESET')
assert.equal(en.duelNextRound, 'NEXT ROUND')
assert.equal(en.duelComplete, 'COMPLETE')
assert.equal(en.duelLock, 'LOCK')
assert.equal(en.duelStartOver, 'START OVER')
assert.equal(en.duelPlaceCoins, 'Tap to place 3 coins.')
// Space between count and ROUND(S); never "5ROUNDS…"
assert.equal(en.duelRoundsReady(5), '5 ROUNDS READY')
assert.ok(/^(\d+) ROUND(S)? READY$/.test(en.duelRoundsReady(5)))
assert.ok(!en.duelRoundsReady(5).startsWith('5R'))

// Complete-screen: primary confirm above start-over (layout, both locales)
{
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '../src/components/DuelFlow.tsx'), 'utf8')
  const appSrc = readFileSync(join(here, '../src/App.tsx'), 'utf8')
  const cssSrc = readFileSync(join(here, '../src/App.css'), 'utf8')
  const start = src.indexOf('if (session.awaitingLock)')
  assert.ok(start >= 0, 'awaitingLock block missing')
  const end = src.indexOf('if (draft.phase === ', start + 1)
  assert.ok(end > start, 'select-bags after awaitingLock missing')
  const completeBlock = src.slice(start, end)
  const lockInComplete = completeBlock.indexOf('onClick={onLock}')
  const startInComplete = completeBlock.indexOf('onClick={onStartOver}')
  assert.ok(lockInComplete >= 0 && startInComplete >= 0)
  assert.ok(
    lockInComplete < startInComplete,
    'complete screen: confirm button must be above start-over',
  )
  // Latin DUEL heading: no JA-only system-ui override
  assert.ok(!appSrc.includes('duel-setup-heading--locale-ja'))
  assert.ok(!cssSrc.includes('duel-setup-heading--locale-ja'))
  assert.ok(src.includes('withDuelNumsAndBreaks'))
}

console.log('verify:locale OK')
