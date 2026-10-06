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
assert.equal(ja.modeSoloDesc, '3枚のコインが隠された袋を当てる')
assert.equal(ja.modeDuelName, 'DUEL')
assert.equal(ja.modeDuelDesc, '互いにコインを隠して当てる2人対戦')
assert.equal(ja.modeGroupName, 'GROUP')
assert.equal(ja.modeGroupDesc, '同じ出題をそれぞれ解いてスコアを競う')
assert.equal(ja.cashOut, '利確して進む')
assert.equal(ja.duelRoundsHint, 'ROUND数を決めてください')
assert.equal(ja.duelContinue, 'OK')
assert.equal(ja.duelTop, 'TOP')
assert.equal(ja.duelSet, 'OK')
assert.equal(ja.duelBack, 'BACK')
assert.equal(ja.duelResetRound, 'RESET')
assert.equal(ja.duelNextRound, 'OK')
assert.equal(ja.duelComplete, 'OK')
assert.equal(ja.duelLock, 'OK')
assert.equal(ja.duelLocking, 'LOCKING...')
assert.equal(ja.duelStartOver, 'RESET ALL')
assert.equal(
  ja.duelStartOverConfirm,
  'すべての設定をリセットしてトップに戻りますか？',
)
assert.equal(
  ja.duelPlaceBomb,
  '袋をタップして\n爆弾を置いてください',
)
assert.ok(ja.duelPlaceBomb.includes('\n'))
assert.equal(
  ja.duelPlaceCoins,
  '袋をタップして\n3枚のコインを置いてください',
)
assert.ok(ja.duelPlaceCoins.includes('\n'))
assert.equal(
  ja.duelPlaceBomb.split('\n')[0],
  ja.duelPlaceCoins.split('\n')[0],
)
assert.equal(ja.duelRoundsReady, 'すべてよろしいですか？')
assert.equal(en.duelRoundsReady, 'ALL ROUNDS READY')
// Complete summary must not embed a dynamic ROUND count
assert.ok(!/\d/.test(ja.duelRoundsReady))
assert.ok(!/\d/.test(en.duelRoundsReady))
assert.ok(!ja.modeDuelName.includes('2人対戦'))

// --- EN: other command labels unchanged ---
assert.equal(en.modeSoloName, 'SOLO')
assert.equal(en.modeSoloDesc, 'Find the 3 hidden coins')
assert.equal(en.modeDuelName, 'DUEL')
assert.equal(en.modeDuelDesc, 'Hide & find — 1 vs 1')
assert.equal(en.modeGroupName, 'GROUP')
assert.equal(en.modeGroupDesc, 'Same challenge — highest score wins')
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(en.duelCashOutRetry, 'Could not cash out. Tap CASH OUT again.')
assert.equal(
  ja.duelCashOutRetry,
  '利確できませんでした。もう一度「利確して進む」をタップしてください。',
)
assert.equal(en.duelContinue, 'CONTINUE')
assert.equal(en.duelTop, 'TOP')
assert.equal(en.duelSet, 'CONTINUE')
assert.equal(en.duelBack, 'BACK')
assert.equal(en.duelResetRound, 'RESET')
assert.equal(en.duelNextRound, 'NEXT ROUND')
assert.equal(en.duelComplete, 'CONTINUE')
assert.equal(en.duelLock, 'LOCK')
assert.equal(en.duelJoining, 'JOINING THE MATCH…')
assert.equal(en.duelWin, 'YOU WIN')
assert.equal(en.duelLose, 'YOU LOSE')
assert.equal(en.duelDraw, 'DRAW')
assert.equal(en.duelStartOver, 'START OVER')
assert.equal(
  en.duelStartOverConfirm,
  'Reset all settings and return to the top?',
)
assert.equal(en.duelPlaceCoins, 'Tap to place 3 coins.')

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
  assert.ok(
    completeBlock.includes('{t.duelRoundsReady}'),
    'complete summary must use fixed duelRoundsReady string',
  )
  assert.ok(
    !completeBlock.includes('duelRoundsReady(session.totalRounds)'),
    'complete summary must not inject totalRounds',
  )
  // READY screen must not gain a mid-flow TOP control
  assert.ok(
    !completeBlock.includes('t.duelTop') && !completeBlock.includes('onGoTop'),
    'complete screen must not add TOP',
  )
  assert.ok(
    completeBlock.includes('duel-complete-spacer--top') &&
      completeBlock.includes('duel-complete-spacer--bottom'),
    'complete screen uses vertical spacers',
  )
  assert.ok(
    cssSrc.includes('.duel-complete-spacer--top') &&
      cssSrc.includes('clamp(1.35rem, 4.2vh, 2.1rem)'),
    'complete summary→button spacing present in CSS',
  )
  assert.ok(
    cssSrc.includes('.app--top .app-topbar') &&
      cssSrc.includes('@media (max-width: 480px)'),
    'phone topbar↔title clearance present',
  )
  // Latin DUEL heading: no JA-only system-ui override
  assert.ok(!appSrc.includes('duel-setup-heading--locale-ja'))
  assert.ok(!cssSrc.includes('duel-setup-heading--locale-ja'))
  assert.ok(src.includes('withDuelNumsAndBreaks'))
  // Setup ROUND/BAG: shared geometry slots (no locale margin hacks)
  assert.ok(
    cssSrc.includes('.duel-flow--setup .duel-instruction') &&
      cssSrc.includes('min-height: calc(1.3rem * 1.35 * 2)'),
    'setup instruction slot must reserve 2-line height',
  )
  assert.ok(
    /\.num-stepper-label\s*{[^}]*min-height:\s*1\.6rem/s.test(cssSrc),
    'stepper label slot must fix JA/EN paren metric height',
  )
  assert.ok(!/:lang\s*\(/.test(cssSrc), 'no :lang() CSS')

  // RESET ALL / START OVER: confirm → discard session + reset draft → goTop
  const soStart = src.indexOf('const onStartOver = useCallback')
  assert.ok(soStart >= 0, 'onStartOver missing')
  const soEnd = src.indexOf('const onLock = useCallback', soStart)
  assert.ok(soEnd > soStart, 'onLock after onStartOver missing')
  const onStartOverBlock = src.slice(soStart, soEnd)
  assert.ok(
    onStartOverBlock.includes('window.confirm(t.duelStartOverConfirm)'),
    'onStartOver must keep window.confirm',
  )
  assert.ok(
    onStartOverBlock.includes('if (!window.confirm(t.duelStartOverConfirm)) return'),
    'cancel must early-return (session/READY preserved, no goTop)',
  )
  assert.ok(
    onStartOverBlock.includes('setSession(null)'),
    'confirm OK must discard DUEL session',
  )
  assert.ok(
    onStartOverBlock.includes('setRoundsDraft(DUEL_ROUNDS_DEFAULT)'),
    'confirm OK must reset ROUND draft to default',
  )
  assert.ok(
    onStartOverBlock.includes('onGoTop?.()') ||
      onStartOverBlock.includes('onGoTop()'),
    'confirm OK must call onGoTop to return to top',
  )
  assert.ok(
    !onStartOverBlock.includes('startOverSession'),
    'onStartOver must not reuse startOverSession (ROUND1 bags path)',
  )

  // Mid-flow TOP only on ROUND setup (!session); bags/place keep BACK
  const roundsSetup = src.slice(
    src.indexOf('if (!session)'),
    src.indexOf('if (session.locked)'),
  )
  assert.ok(roundsSetup.includes('t.duelTop'), 'ROUND setup keeps TOP')
  assert.ok(roundsSetup.includes('onGoTop'), 'ROUND setup TOP uses onGoTop')
  const bagsBlockStart = src.indexOf("if (draft.phase === 'select-bags')")
  const bagsBlockEnd = src.indexOf('/* ——— Place', bagsBlockStart)
  const bagsBlock = src.slice(
    bagsBlockStart,
    bagsBlockEnd > bagsBlockStart ? bagsBlockEnd : bagsBlockStart + 1200,
  )
  assert.ok(bagsBlock.includes('t.duelBack'), 'BAGS keeps BACK')
  assert.ok(!bagsBlock.includes('t.duelTop'), 'BAGS must not add TOP')

  // Placement screens: advance is first, then RESET, then BACK (both locales).
  const placeStart = src.indexOf('data-duel-slot="buttons"')
  assert.ok(placeStart >= 0, 'placement button slot missing')
  const placeButtons = src.slice(placeStart, placeStart + 2600)
  const advance = placeButtons.indexOf('data-duel-metric="place-advance"')
  const reset = placeButtons.indexOf('data-duel-metric="place-reset"')
  const back = placeButtons.indexOf('onClick={onBackFromPlace}')
  assert.ok(advance >= 0 && reset >= 0 && back >= 0)
  assert.ok(advance < reset && reset < back, 'placement order must be advance → RESET → BACK')
}

console.log('verify:locale OK')
