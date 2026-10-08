/**
 * DUEL setup (ROUND/BAG): JA/EN geometry slots — no locale-only margin hacks.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [appCss, stepperSource, flowSource] = await Promise.all([
  readFile('src/App.css', 'utf8'),
  readFile('src/components/NumberStepper.tsx', 'utf8'),
  readFile('src/components/DuelFlow.tsx', 'utf8'),
])

/* Confirmed JA copy; EN wording stays unchanged. */
assert.equal(ja.duelRoundsHint, 'ROUND数を決めてください')
assert.equal(en.duelRoundsHint, 'Choose the number of rounds.')
assert.equal(ja.duelBagsHint, '袋の数を決めてください')
assert.equal(en.duelBagsHint, 'Choose the number of bags.')
assert.equal(ja.duelBagsLabel, 'BAGS（3-8）')
assert.equal(en.duelBagsLabel, 'BAGS（3-8）')
assert.equal(ja.duelRoundsLabel, 'ROUNDS（1-20）')
assert.equal(en.duelRoundsLabel, 'ROUNDS（1-20）')
assert.equal(ja.duelRoundsLabel, en.duelRoundsLabel)
assert.equal(ja.duelBagsLabel, en.duelBagsLabel)

/* Setup instruction slot (not place). */
assert.match(
  appCss,
  /\.duel-flow--setup \.duel-instruction\s*{[^}]*min-height:\s*calc\(1\.3rem \* 1\.35 \* 2\)/s,
)
assert.match(
  appCss,
  /\.duel-flow--setup \.duel-instruction\s*{[^}]*display:\s*flex/s,
)

/* Stepper label slot absorbs fullwidth vs ASCII paren metrics. */
assert.match(
  appCss,
  /\.num-stepper-label\s*{[^}]*min-height:\s*1\.6rem/s,
)
assert.match(
  appCss,
  /\.num-stepper-label\s*{[^}]*line-height:\s*1\.35/s,
)
assert.match(
  appCss,
  /\.num-stepper-label\s*{[^}]*display:\s*flex/s,
)

/* No locale-specific CSS / transform hacks. */
assert.doesNotMatch(appCss, /:lang\s*\(/)
assert.doesNotMatch(appCss, /locale-ja|locale-en|html\[lang/)
assert.doesNotMatch(appCss, /\.num-stepper-label[^{]*{[^}]*transform:/s)

/* Digits stay on duel-num path; button field unchanged. */
assert.match(stepperSource, /num-stepper-value duel-num/)
assert.match(stepperSource, /data-duel-metric="label"/)
assert.match(flowSource, /data-duel-metric="instruction"/)
assert.match(appCss, /--duel-button-field-h:\s*9\.35rem/)

/* Short viewport keeps a 2-line setup instruction slot. */
assert.match(
  appCss,
  /\.duel-flow--setup \.duel-instruction\s*{[^}]*min-height:\s*calc\(1\.15rem \* 1\.35 \* 2\)/s,
)

console.log('verify-duel-setup-locale-client: all checks passed')
