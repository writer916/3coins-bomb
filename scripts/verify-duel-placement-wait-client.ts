/**
 * DUEL wait UI: unified opponent-placement status + bottom quiet TOP.
 * Does not assert API/DB/polling contract changes.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [
  waitSource,
  panelSource,
  flowSource,
  confirmSource,
  appCss,
  appSource,
] = await Promise.all([
  readFile('src/components/DuelPlacementWait.tsx', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
  readFile('src/components/DuelFlow.tsx', 'utf8'),
  readFile('src/components/DuelStartConfirm.tsx', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
])

/* 1–4: copy + wait component. */
assert.equal(ja.duelWaitingForOpponentPlacement, '相手の配置を待っています')
assert.equal(
  en.duelWaitingForOpponentPlacement,
  'WAITING FOR OPPONENT',
)
assert.match(waitSource, /duelWaitingForOpponentPlacement/)
assert.match(waitSource, /duel-placement-wait__status/)
assert.match(waitSource, /duel-btn--quiet-top/)
assert.match(waitSource, /duelReturnToTop/)
assert.doesNotMatch(waitSource, /duelPlacementsLocked/)
assert.doesNotMatch(waitSource, /duelInviteOpponentJoined/)

/* Wait branches use shared component; old locked/joined wait copy gone. */
assert.match(panelSource, /DuelPlacementWait/)
assert.match(flowSource, /DuelPlacementWait/)
assert.doesNotMatch(panelSource, /duelPlacementsLocked/)
assert.doesNotMatch(panelSource, /duelInviteOpponentJoined/)
assert.doesNotMatch(flowSource, /duelPlacementsLocked/)
assert.doesNotMatch(
  panelSource,
  /joined\s*\?\s*\(\s*<p className="duel-invite-note"/,
)

/* 5: joined still polled; UI does not branch on it. */
assert.match(panelSource, /setJoined\(true\)/)
assert.doesNotMatch(panelSource, /if\s*\(\s*joined\s*\)/)
assert.doesNotMatch(panelSource, /\{joined\s*\?/)

/* 6–7: playReady false → wait; true → StartConfirm. */
assert.match(panelSource, /playReady && matchMeta/)
assert.match(panelSource, /DuelStartConfirm/)
assert.match(panelSource, /inviteWizardFinished/)
assert.match(
  panelSource,
  /if \(inviteWizardFinished\)[\s\S]*?DuelStartConfirm[\s\S]*?DuelPlacementWait/s,
)

/* 8: TOP → goTop unchanged. */
assert.match(appSource, /onGoTop=\{goTop\}/)
assert.match(appSource, /setDuelBootstrapUrl\(null\)/)
assert.match(appSource, /replaceState\(null, '', '\/'\)/)
assert.doesNotMatch(appSource, /removeItem\(participantStorageKey/)

/* 9: StartConfirm — START stays in actions; TOP is quiet bottom sibling. */
assert.match(confirmSource, /duel-start-confirm__actions/)
assert.match(confirmSource, /duel-start-confirm__start/)
assert.match(confirmSource, /duel-btn--quiet-top duel-start-confirm__top/)
assert.match(
  confirmSource,
  /duel-start-confirm__actions[\s\S]*duel-start-confirm__start[\s\S]*<\/div>\s*\{onGoTop/s,
)

/* 10: global controls still App-owned. */
assert.match(appSource, /LanguageToggle|topControls/)
assert.match(appCss, /\.duel-btn--quiet-top\s*{[^}]*margin-top:\s*auto/s)
assert.match(appCss, /\.duel-flow--placement-wait\s*{/)
assert.match(
  appCss,
  /\.duel-placement-wait__status\s*{[^}]*min-height:\s*calc\(/s,
)
assert.match(
  appCss,
  /\.duel-flow--placement-wait\s*{[^}]*safe-area-inset-bottom/s,
)
assert.match(
  appCss,
  /\.duel-flow--start-confirm\s*{[^}]*safe-area-inset-bottom/s,
)

/* Polling contract unchanged. */
assert.match(panelSource, /DUEL_READY_POLL_INTERVAL_MS = 5_000/)
assert.match(panelSource, /visibilitychange/)
assert.match(panelSource, /addEventListener\('focus'/)

console.log('verify-duel-placement-wait-client: all checks passed')
