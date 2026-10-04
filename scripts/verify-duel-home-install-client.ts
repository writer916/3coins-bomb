/**
 * Final RESULT “Add to Home Screen” CTA contracts (no SW / no capability URL).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'
import {
  detectHomeInstallPlatform,
  getHomeInstallSnapshot,
  homeInstallGuideKind,
  isStandaloneDisplay,
} from '../src/pwa/homeInstall'

const [
  resultScreen,
  homeInstall,
  homeInstallHook,
  appCss,
  manifestRaw,
  html,
  types,
] = await Promise.all([
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/pwa/homeInstall.ts', 'utf8'),
  readFile('src/pwa/useHomeInstallCta.ts', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('public/manifest.webmanifest', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('src/i18n/types.ts', 'utf8'),
])

const completedBlock = resultScreen.slice(
  resultScreen.indexOf('function CompletedResult'),
  resultScreen.indexOf('function CompletionShell'),
)
const completionShell = resultScreen.slice(
  resultScreen.indexOf('function CompletionShell'),
  resultScreen.indexOf('export function DuelResultScreen'),
)

/* CTA only on completed RESULT; TOP above ADD. */
assert.match(completedBlock, /duel-final-actions/)
assert.match(completedBlock, /t\.duelReturnToTop/)
assert.match(completedBlock, /t\.duelAddToHomeScreen/)
assert.match(completedBlock, /duel-final-home-install/)
assert.match(completedBlock, /useHomeInstallCta/)
const topIdx = completedBlock.indexOf('t.duelReturnToTop')
const addIdx = completedBlock.indexOf('t.duelAddToHomeScreen')
assert.ok(topIdx >= 0 && addIdx > topIdx, 'TOP must render above ADD TO HOME SCREEN')

assert.doesNotMatch(completionShell, /duelAddToHomeScreen|duel-final-home-install|useHomeInstallCta/)
assert.doesNotMatch(completionShell, /duelReturnToTop|onGoTop|duel-final-return/)

/* Standalone / install hide path. */
assert.match(homeInstall, /display-mode:\s*standalone/)
assert.match(homeInstall, /navigator\.standalone|standalone === true/)
assert.match(homeInstall, /showCta:\s*!standalone && !installed/)
assert.match(homeInstall, /beforeinstallprompt/)
assert.match(homeInstall, /appinstalled/)
assert.match(homeInstall, /preventDefault/)
assert.match(homeInstall, /\.prompt\(/)
assert.match(homeInstallHook, /tryNativeHomeInstall/)
assert.match(homeInstallHook, /setGuideOpen\(true\)/)
assert.match(homeInstallHook, /subscribeHomeInstall/)
assert.match(homeInstallHook, /return \(\) =>/)

/* Overlay: QR-style dialog, no capability URLs. */
assert.match(completedBlock, /duel-home-install-overlay/)
assert.match(completedBlock, /role="dialog"/)
assert.match(completedBlock, /aria-modal="true"/)
assert.match(completedBlock, /duelAddToHomeGuideIos|duelAddToHomeGuideAndroid|duelAddToHomeGuideGeneric/)
assert.match(appCss, /\.duel-home-install-overlay/)
assert.match(appCss, /\.duel-invite-qr-overlay,\s*\.duel-home-install-overlay/s)
assert.match(appCss, /\.duel-final-actions\s*{[^}]*flex-direction:\s*column/s)
assert.match(appCss, /\.duel-final-actions\s*{[^}]*width:\s*min\(100%,\s*16\.5rem\)/s)
assert.match(appCss, /\.duel-final-home-install\s*{/)

/* i18n */
assert.equal(ja.duelAddToHomeScreen, 'ホーム画面に追加')
assert.equal(en.duelAddToHomeScreen, 'ADD TO HOME SCREEN')
assert.equal(
  ja.duelAddToHomeGuideIos,
  'ブラウザのメニューから「ホーム画面に追加」を選んでください。',
)
assert.equal(en.duelAddToHomeGuideIos, 'Choose “Add to Home Screen” from your browser menu.')
assert.equal(
  ja.duelAddToHomeGuideAndroid,
  'ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。',
)
assert.equal(
  en.duelAddToHomeGuideAndroid,
  'Choose “Add to Home Screen” or “Install app” from your browser menu.',
)
assert.match(types, /duelAddToHomeScreen/)
assert.match(types, /duelAddToHomeGuideIos/)
assert.match(types, /duelAddToHomeGuideAndroid/)
assert.match(types, /duelAddToHomeGuideGeneric/)
assert.match(types, /duelAddToHomeGuideClose/)

/* Safety: no capability / duel URL install metadata. */
for (const source of [homeInstall, homeInstallHook, completedBlock, manifestRaw]) {
  assert.doesNotMatch(source, /#p=|#invite=|3cb_pa1_|3cb_pi1_|3cb_pb1_/)
  assert.doesNotMatch(source, /shortcuts/)
}
assert.doesNotMatch(homeInstall, /serviceWorker|navigator\.serviceWorker/)
assert.doesNotMatch(homeInstallHook, /serviceWorker|navigator\.serviceWorker/)

const manifest = JSON.parse(manifestRaw) as { start_url: string; scope: string }
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.match(html, /rel="apple-touch-icon"/)

/* Helper smoke (node has no window → safe defaults). */
assert.equal(isStandaloneDisplay(), false)
assert.equal(detectHomeInstallPlatform(), 'other')
assert.equal(homeInstallGuideKind('ios'), 'ios')
assert.equal(homeInstallGuideKind('android'), 'android')
assert.equal(homeInstallGuideKind('other'), 'generic')
assert.equal(getHomeInstallSnapshot().showCta, true)

console.log('verify-duel-home-install-client: all checks passed')
