/**
 * Global top controls + StartConfirm digits/locale slots + PLAY footer 20/20.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

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
assert.match(confirmSource, /duel-start-confirm__actions/)

/* 2b. JA/EN ROUNDS label+value identical (number only). */
assert.equal(ja.duelStartConfirmRoundsLabel, 'ROUNDS')
assert.equal(en.duelStartConfirmRoundsLabel, 'ROUNDS')
assert.equal(ja.duelStartConfirmRoundsValue(2), '2')
assert.equal(en.duelStartConfirmRoundsValue(2), '2')
assert.equal(ja.duelStartConfirmRoundsValue(20), '20')
assert.equal(en.duelStartConfirmRoundsValue(20), '20')

/* 2c. StartConfirm fixed geometry slots (no locale-only margin hacks). */
assert.match(appCss, /\.duel-start-confirm__created\s*{[^}]*min-height:/s)
assert.match(appCss, /\.duel-start-confirm__ready\s*{[^}]*min-height:/s)
assert.match(appCss, /\.duel-start-confirm__list\s*{[^}]*min-height:/s)
assert.match(appCss, /\.duel-start-confirm__actions\s*{/)
assert.match(
  appCss,
  /\.duel-start-confirm__start[\s\S]*?height:\s*2\.75rem/,
)
/* TOP is quiet bottom secondary — not equal-strength to START. */
assert.match(confirmSource, /duel-btn--quiet-top duel-start-confirm__top/)
assert.match(appCss, /\.duel-btn--quiet-top\s*{[^}]*margin-top:\s*auto/s)
assert.doesNotMatch(
  confirmSource,
  /duel-start-confirm__actions[\s\S]*duel-start-confirm__top[\s\S]*<\/div>\s*<\/div>/s,
)

/* 3. PLAY footer: centered max-content cluster; shared pair-gap + separate group-gap. */
assert.match(playScreenSource, /score-label">ROUNDS/)
assert.match(playScreenSource, /completedRounds\} \/ \{view\.totalRounds/)
assert.match(playScreenSource, /score-label">COINS/)
assert.match(playScreenSource, /withDuelNums\('3COINS COMPLETE'\)/)
assert.match(appCss, /--duel-score-pair-gap:\s*0\.45rem/)
assert.match(appCss, /--duel-score-group-gap:\s*1\.15rem/)
assert.match(appCss, /\.duel-play \.score-item\s*{[^}]*gap:\s*var\(--duel-score-pair-gap\)/s)
assert.match(appCss, /\.duel-play \.score-row\s*{[^}]*column-gap:\s*var\(--duel-score-group-gap\)/s)
assert.match(appCss, /\.duel-play \.score-num\s*{[^}]*min-width:\s*0/s)
assert.match(appCss, /\.duel-play \.score-num\s*{[^}]*text-align:\s*left/s)
assert.doesNotMatch(appCss, /\.duel-play[^{]*\{[^}]*7\.5ch/)
assert.doesNotMatch(
  appCss,
  /\.duel-play \.score-row > \.score-item:first-child \.score-num\s*{[^}]*min-width:\s*7\.5ch/s,
)
assert.match(appCss, /\.score-row--secondary\s*{[^}]*justify-content:\s*flex-start/s)
assert.doesNotMatch(appCss, /\.duel-play \.score-stack\s*{/)
assert.doesNotMatch(appCss, /\.duel-play \.score-row\s*{[^}]*justify-content:\s*space-between/s)
assert.doesNotMatch(appCss, /width: min\(100%, 22\.75rem\)/)
assert.match(appCss, /\.score-stack\s*{[^}]*width:\s*max-content/s)
assert.match(appCss, /\.score-row\s*{[^}]*justify-content:\s*center/s)

/* RESULT presentation still exists; same-session reveal is a later/parallel concern. */
assert.match(resultScreenSource, /phase === 'result-ready'/)
assert.match(resultScreenSource, /t\.duelViewResult/)

console.log('verify-duel-mobile-ui-client: all checks passed')
