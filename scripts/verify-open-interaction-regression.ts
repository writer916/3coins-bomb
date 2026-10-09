/** Regression checks for continuing OPEN unlock and CASH OUT button persistence. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, duel, group] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/GroupPlayScreen.tsx', 'utf8'),
])

// SOLO: 0 COIN remains governed by canCashOut; FX changes enablement, not DOM visibility.
assert.match(app, /const showCashOut = canCashOut\(round\) && !showEndActions/)
assert.doesNotMatch(app, /const showCashOut =[^\n]*!openFxActive/)
assert.match(app, /className="dev-btn cash-out-btn" disabled=\{openFxActive\}/)
assert.match(app, /if \(fxLockRef\.current\) return/)
assert.match(app, /onVisualComplete=\{coinFx\.clearsRound \? undefined : clearContinuingOpenFx\}/)
assert.match(app, /onVisualComplete=\{clearContinuingOpenFx\}/)

// DUEL: optimistic/server gate remains authoritative; pending/FX only disable CASH OUT.
assert.match(duel, /canOfferDuelCashOut\(round\) && !showEndActions && !revealed/)
assert.match(duel, /disabled=\{requestPending \|\| openFxActive\}/)
assert.match(duel, /createOptimisticOpenGate\(\)/)
assert.match(duel, /markOptimisticServerDone\(gate\)/)
assert.match(duel, /onVisualComplete=\{fx\.clearsRound \? undefined : clearFx\}/)
assert.match(duel, /kind === 'empty'[\s\S]*onVisualComplete=\{clearFx\}/)

// GROUP keeps its established visibility/disabled split and gains only visual unlock wiring.
assert.match(group, /canShowGroupCashOutButton/)
assert.match(group, /isGroupCashOutButtonDisabled/)
assert.match(group, /disabled=\{cashOutDisabled\}/)
assert.match(group, /onVisualComplete=\{fx\.clearsRound \? undefined : fxComplete\}/)
assert.match(group, /kind === 'empty'[\s\S]*onVisualComplete=\{fxComplete\}/)

console.log('verify:open-interaction-regression OK')
