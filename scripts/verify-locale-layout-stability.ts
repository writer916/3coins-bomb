import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  app,
  appCss,
  duelInvite,
  groupInvite,
  duelPlay,
  groupPlay,
  groupWaiting,
  duelResult,
  groupResult,
] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
  readFile('src/components/GroupInviteShareScreen.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/GroupPlayScreen.tsx', 'utf8'),
  readFile('src/components/GroupCompletionWaiting.tsx', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/GroupResultScreen.tsx', 'utf8'),
])

/* The browser language follows the persisted app locale on first render and toggle. */
assert.match(
  app,
  /useEffect\(\(\) => \{\s*document\.documentElement\.lang = locale\s*\}, \[locale\]\)/s,
)

/* Shipped JA/EN copy gets equal minimums; unexpected copy may grow naturally. */
assert.doesNotMatch(appCss, /\.stable-message-slot\s*{[^}]*(?:overflow|height|max-height):/s)
assert.match(appCss, /\.stable-message-slot--feedback\s*{[^}]*min-height:\s*calc\(0\.76rem \* 1\.25 \* 2\)/s)
assert.match(appCss, /\.stable-message-slot--play-error\s*{[^}]*min-height:\s*calc\(0\.86rem \* 1\.4 \* 3\)/s)
assert.match(appCss, /\.stable-message-slot--waiting-error\s*{[^}]*min-height:\s*calc\(0\.9rem \* 1\.4 \* 2\)/s)
assert.match(appCss, /\.stable-message-slot--detail-error\s*{[^}]*min-height:\s*calc\(1\.1rem \* 1\.4 \* 3\)/s)
for (const modifier of ['feedback', 'play-error', 'waiting-error', 'detail-error']) {
  const block = appCss.match(new RegExp(`\\.stable-message-slot--${modifier}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  assert.doesNotMatch(block, /(?:^|\s)(?:height|max-height|overflow(?:-[xy])?):/)
}

for (const source of [duelInvite, groupInvite]) {
  assert.match(source, /duel-invite-feedback stable-message-slot stable-message-slot--feedback/)
}
for (const source of [duelPlay, groupPlay]) {
  assert.match(source, /duel-play-error stable-message-slot stable-message-slot--play-error/)
}
assert.match(groupWaiting, /stable-message-slot--waiting-error/)
assert.match(groupWaiting, /aria-hidden=\{error \? undefined : 'true'\}/)
assert.match(duelResult, /duel-match-detail-error__copy stable-message-slot stable-message-slot--detail-error/)
assert.match(groupResult, /group-result-detail-error__copy stable-message-slot stable-message-slot--detail-error/)

/* Home-install copy is natural-height; only the whole modal may scroll. */
assert.match(duelResult, /<p className="duel-home-install-copy">\{guideCopy\}<\/p>/)
assert.doesNotMatch(duelResult, /duel-home-install-copy-frame/)
assert.match(appCss, /\.duel-home-install-overlay\s*{[^}]*overflow-y:\s*auto/s)
assert.match(appCss, /\.duel-home-install-panel\s*{[^}]*margin:\s*auto 0/s)
assert.match(appCss, /\.duel-home-install-copy\s*{[^}]*min-height:\s*clamp\(6\.8875rem, 26\.1vw, 7\.975rem\)/s)
assert.doesNotMatch(appCss, /duel-home-install-copy-frame/)

/* No locale-specific positioning workaround; established button geometry is intact. */
assert.doesNotMatch(appCss, /:lang\s*\(|locale-ja|locale-en|html\[lang/)
assert.match(appCss, /--duel-button-field-h:\s*9\.35rem/)
assert.match(appCss, /\.duel-btn-stack\.standard-action-stack\s*{[^}]*width:\s*min\(100%,\s*8rem\)/s)

console.log('verify-locale-layout-stability: all checks passed')
