/**
 * Global top controls + StartConfirm digit fonts + PLAY footer 20/20 width.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  appSource,
  bootstrapSource,
  confirmSource,
  playScreenSource,
  appCss,
  resultScreenSource,
] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/DuelClaimBootstrap.tsx', 'utf8'),
  readFile('src/components/DuelStartConfirm.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
])

/* 1. App topControls shared into bootstrap — no duplicated toggle state. */
assert.match(appSource, /topControls=\{topControls\}/)
assert.match(appSource, /const topControls = \(/)
assert.match(bootstrapSource, /readonly topControls: ReactNode/)
assert.match(bootstrapSource, /\{topControls\}/)
assert.match(bootstrapSource, /DuelBootstrapShell t=\{t\} topControls=\{topControls\}/)
assert.doesNotMatch(bootstrapSource, /LanguageToggle|SoundToggle|useState\(\(\) => readSound/)
assert.doesNotMatch(bootstrapSource, /writeLocale|handleLanguageToggle/)

/* 2. StartConfirm digits via withDuelNums / .duel-num path. */
assert.match(confirmSource, /withDuelNums/)
assert.match(confirmSource, /withDuelNums\(createdLabel\)/)
assert.match(
  confirmSource,
  /withDuelNums\(t\.duelStartConfirmRoundsValue\(totalRounds\)\)/,
)

/* 3. PLAY footer widened under .duel-play only; score fields unchanged. */
assert.match(playScreenSource, /score-label">ROUNDS/)
assert.match(playScreenSource, /completedRounds\} \/ \{view\.totalRounds/)
assert.match(playScreenSource, /score-label">COINS/)
assert.match(playScreenSource, /score-label">3COINS COMPLETE/)
assert.match(appCss, /\.duel-play \.score-stack/)
assert.match(appCss, /width: min\(100%, 22\.75rem\)/)
assert.match(appCss, /\.duel-play \.score-row/)
assert.match(appCss, /min-width: 7\.5ch/)
assert.match(appCss, /Do not shrink fonts to pack/)

/* RESULT path untouched this phase. */
assert.match(resultScreenSource, /phase === 'result-ready'/)
assert.match(resultScreenSource, /t\.duelViewResult/)
assert.doesNotMatch(playScreenSource, /initialRevealed/)

console.log('verify-duel-mobile-ui-client: all checks passed')
