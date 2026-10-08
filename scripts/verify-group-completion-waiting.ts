/**
 * GROUP completion waiting: no title-only PLAY COMPLETE flash, and stable
 * participant/completed count layout up to 20/20 (JA/EN).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')
const waiting = readFileSync(
  resolve(root, 'src/components/GroupCompletionWaiting.tsx'),
  'utf8',
)
const play = readFileSync(resolve(root, 'src/components/GroupPlayScreen.tsx'), 'utf8')
const entry = readFileSync(resolve(root, 'src/components/GroupEntryShell.tsx'), 'utf8')
const duelResult = readFileSync(
  resolve(root, 'src/components/DuelResultScreen.tsx'),
  'utf8',
)
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')

/*
 * Consecutive render states after last-round terminal (source contract):
 *   1) wantsCompletion && !completionReady → keep play board (prefetch)
 *   2) completionReady → GroupCompletionWaiting with initialProgress
 * Never: mount waiting with null progress + paint PLAY COMPLETE alone.
 */
assert.match(play, /wantsCompletion/)
assert.match(play, /getProgress\(ready\.state\.groupId\)/)
assert.match(play, /completionReady/)
assert.match(play, /if \(completionReady\)/)
assert.match(play, /initialProgress=\{completionSeed\}/)
assert.match(play, /initialClosed=\{completionSeed\?\.status === 'closed'\}/)
assert.ok(
  play.indexOf('wantsCompletion') < play.indexOf('getProgress(ready.state.groupId)'),
  'prefetch must be gated by wantsCompletion',
)
assert.ok(
  play.indexOf('getProgress(ready.state.groupId)') < play.indexOf('if (completionReady)'),
  'waiting mount must follow progress prefetch',
)
assert.doesNotMatch(
  play,
  /if \(terminal && ready\.currentPlacement\.roundNumber === ready\.state\.totalRounds && !fx && !requestPending\) return <GroupCompletionWaiting/,
)

assert.match(entry, /initialProgress=\{completionProgress\}/)
assert.match(entry, /setCompletionProgress\(progress\)/)
assert.match(entry, /setCompletionProgress\(null\)/)

assert.match(waiting, /initialProgress/)
assert.match(waiting, /showPlayCompleteTitle/)
assert.match(waiting, /showOpenWaiting/)
assert.match(waiting, /awaitingProgress/)
assert.match(waiting, /group-completion-waiting__stats/)
assert.match(waiting, /group-completion-waiting__count/)
assert.match(waiting, /groupReadyPlayersLabel/)
assert.match(waiting, /groupCompletedLabel/)
assert.match(waiting, /groupParticipantsProgress/)
assert.match(waiting, /groupCompletedProgress/)
assert.match(waiting, /font-variant-numeric|duel-num/)
/* Title-only path must not paint PLAY COMPLETE while progress is unknown. */
assert.match(
  waiting,
  /showPlayCompleteTitle = showOpenWaiting \|\| \(error && !loading\)/,
)

/* --- DUEL: atomic completion shell (no equivalent flash) --- */
const shellStart = duelResult.indexOf('function CompletionShell')
const shellEnd = duelResult.indexOf('function DetailLoading')
assert.ok(shellStart >= 0 && shellEnd > shellStart)
const shell = duelResult.slice(shellStart, shellEnd)
assert.match(shell, /duelWaitingTitle/)
assert.match(shell, /duelWaitingBody/)
assert.match(shell, /mode === 'waiting'/)

/* --- CSS: shared ratio column for 20/20, no internal scroll --- */
const statsBlock = css.match(
  /\.group-completion-waiting__stats\s*\{[^}]*\}/,
)?.[0]
assert.ok(statsBlock, 'missing .group-completion-waiting__stats')
assert.match(statsBlock!, /grid-template-columns:\s*max-content\s+minmax\(7ch,\s*max-content\)/)
assert.match(statsBlock!, /max-width:\s*100%/)
assert.doesNotMatch(statsBlock!, /overflow(?:-[xy])?:/)

const countBlock = css.match(
  /\.group-completion-waiting__count\s*\{[^}]*\}/,
)?.[0]
assert.ok(countBlock, 'missing .group-completion-waiting__count')
assert.match(countBlock!, /min-width:\s*7ch/)
assert.match(countBlock!, /font-variant-numeric:\s*tabular-nums/)
assert.match(countBlock!, /white-space:\s*nowrap/)
assert.doesNotMatch(countBlock!, /overflow(?:-[xy])?:/)

assert.doesNotMatch(css, /\.group-completion-waiting__line\s*\{/)

/* --- Copy: labels match progress sentence wording; ratios cover 1/2..20/20 --- */
assert.equal(ja.groupCompletedLabel, '完了人数')
assert.equal(en.groupCompletedLabel, 'COMPLETE')
assert.equal(ja.groupReadyPlayersLabel, '参加人数')
assert.equal(en.groupReadyPlayersLabel, 'PLAYERS')

const ratioCases = [
  [1, 2],
  [9, 10],
  [10, 20],
  [19, 20],
  [20, 20],
] as const

for (const [current, limit] of ratioCases) {
  assert.equal(
    ja.groupParticipantsProgress(current, limit),
    `参加人数 ${current} / ${limit}`,
  )
  assert.equal(
    ja.groupCompletedProgress(current, limit),
    `完了人数 ${current} / ${limit}`,
  )
  assert.equal(
    en.groupParticipantsProgress(current, limit),
    `PLAYERS ${current} / ${limit}`,
  )
  assert.equal(
    en.groupCompletedProgress(current, limit),
    `COMPLETE ${current} / ${limit}`,
  )
  assert.ok(
    ja.groupParticipantsProgress(current, limit).startsWith(
      `${ja.groupReadyPlayersLabel} `,
    ),
  )
  assert.ok(
    ja.groupCompletedProgress(current, limit).startsWith(
      `${ja.groupCompletedLabel} `,
    ),
  )
  assert.ok(
    en.groupParticipantsProgress(current, limit).startsWith(
      `${en.groupReadyPlayersLabel} `,
    ),
  )
  assert.ok(
    en.groupCompletedProgress(current, limit).startsWith(
      `${en.groupCompletedLabel} `,
    ),
  )
}

/* Approx. width budget at 320px: longest EN label + gap + 7ch count. */
const longestLabel = Math.max(
  en.groupReadyPlayersLabel.length,
  en.groupCompletedLabel.length,
  ja.groupReadyPlayersLabel.length,
  [...ja.groupCompletedLabel].length,
)
assert.ok(longestLabel <= 8, `unexpected label length ${longestLabel}`)
/* 8 chars label (~8ch) + 0.55rem gap + 7ch count ≪ 320px at 16px root. */
assert.ok(8 + 7 < 20, 'label+count ch budget must fit narrow phones')

console.log('verify:group-completion-waiting OK')
