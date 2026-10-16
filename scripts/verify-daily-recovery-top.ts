/** DAILY bounded recovery, TOP reachability, and revisit contracts (no DB/network). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const screen = readFileSync(resolve(root, 'src/components/DailyPlayScreen.tsx'), 'utf8')
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
const modeSelect = readFileSync(resolve(root, 'src/components/ModeSelect.tsx'), 'utf8')
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')

// Automatic retry does not depend only on online/visibility, is finite, and
// stays behind the existing single-flight reconcile guard.
assert.match(screen, /canScheduleDailyRecoveryRetry\(attemptsCompleted\)/)
assert.match(screen, /dailyRecoveryRetryDelayMs\(attemptsCompleted \+ 1\)/)
assert.match(screen, /if \(reconcileInFlightRef\.current\) continue/)
assert.match(screen, /await reconcileAfterMutationFailure\(mode\)/)
assert.match(screen, /coordinator\.getPendingOpen\(\)/)
assert.match(screen, /coordinator\.getPendingCashOut\(\)/)

// TOP keeps all four existing modes and DAILY remains the local-gated revisit
// path. START owns restoration; TOP itself performs no participant mutation.
for (const mode of ['solo', 'duel', 'group', 'daily']) {
  assert.match(modeSelect, new RegExp(`onSelect\\('${mode}'\\)`))
}
assert.match(app, /decideDailyPriorFinalGate\(\{ storage \}\)/)
assert.match(app, /setDailyPhase\(\{ kind: 'prestart' \}\)/)
assert.match(app, /setScreen\('daily'\)/)
assert.doesNotMatch(modeSelect, /fetch\(|localStorage\.removeItem|sessionStorage\.removeItem/)

// On SE-class widths the list sizes to content and starts at the top, allowing
// normal document scrolling to the fourth card above Safari's bottom inset.
assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.app--top \.mode-select \{[\s\S]*?flex: 0 0 auto;/)
assert.match(css, /\.app--top \.mode-select \{[\s\S]*?justify-content: flex-start;/)
assert.match(css, /padding-bottom: max\(1rem, env\(safe-area-inset-bottom, 0px\)\)/)

console.log('daily recovery/top verification: PASS')
