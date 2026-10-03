/**
 * DUEL invite wizard (DI01/DI02): JA/EN note slot — no locale margin hacks.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [appCss, panelSource] = await Promise.all([
  readFile('src/App.css', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
])

/* Copy unchanged — layout-only fix. */
assert.equal(
  ja.duelInviteOpponentIntro,
  '相手にこのURLを送り、コインと爆弾の位置を決めてもらいましょう。',
)
assert.equal(
  en.duelInviteOpponentIntro,
  'Send this URL to your opponent and have them place their coins and bomb.',
)
assert.equal(
  ja.duelSelfUrlIntro,
  '相手が配置を完了すると、このURLで対戦を始められます。勝負が終わるまで保管してください。',
)
assert.equal(
  en.duelSelfUrlIntro,
  'Once your opponent finishes placement, you can start the match from this URL. Keep it until the match ends.',
)

/* Shared note slot on invite page only. */
assert.match(
  appCss,
  /\.duel-invite-page \.duel-invite-note\s*{[^}]*min-height:\s*calc\(0\.86rem \* 1\.55 \* 3\)/s,
)
assert.match(
  appCss,
  /\.duel-invite-page \.duel-invite-note\s*{[^}]*display:\s*flex/s,
)
assert.match(panelSource, /duel-invite-page/)
assert.match(panelSource, /duel-invite-note/)
assert.match(panelSource, /duelInviteOpponentIntro|duelSelfUrlIntro/)

/* No locale-specific CSS. */
assert.doesNotMatch(appCss, /:lang\s*\(/)
assert.doesNotMatch(appCss, /locale-ja|locale-en|html\[lang/)

/* Wizard / URL plumbing still present (no logic rewrite). */
assert.match(panelSource, /page === 'opponent'|page === \"opponent\"|page===/)
assert.match(panelSource, /inviteWizardFinished|onFinishInviteWizard|duel-invite-url-bar/)

console.log('verify-duel-invite-locale-client: all checks passed')
