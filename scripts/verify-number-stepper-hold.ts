/** Source contracts for NumberStepper hold-to-repeat (no browser). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = readFileSync(
  resolve(root, 'src/components/NumberStepper.tsx'),
  'utf8',
)
const groupFlow = readFileSync(
  resolve(root, 'src/components/GroupCreateFlow.tsx'),
  'utf8',
)
const groupDomain = readFileSync(
  resolve(root, 'src/group/groupDomain.ts'),
  'utf8',
)
const duelPlacement = readFileSync(
  resolve(root, 'src/game/duelPlacement.ts'),
  'utf8',
)

assert.match(source, /HOLD_DELAY_MS = 400/)
assert.match(source, /onPointerDown/)
assert.match(source, /onPointerUp/)
assert.match(source, /onPointerCancel/)
assert.match(source, /onPointerMove/)
assert.match(source, /setPointerCapture/)
assert.match(source, /onLostPointerCapture/)
assert.match(source, /suppressClickRef/)
assert.match(source, /visibilitychange/)
assert.match(source, /Math\.min\(\s*maxRef\.current/)
assert.match(source, /Math\.max\(\s*minRef\.current/)
assert.doesNotMatch(source, /value\s*=\s*min[\s\S]*value\s*=\s*max|wrap|modulo/)

assert.match(groupDomain, /GROUP_ROUNDS_DEFAULT = 5/)
assert.match(groupFlow, /GROUP_ROUNDS_DEFAULT/)
assert.match(groupFlow, /totalRounds: GROUP_ROUNDS_DEFAULT/)
assert.match(duelPlacement, /DUEL_ROUNDS_DEFAULT = 5/)

console.log('verify:number-stepper-hold OK')
