/**
 * Phase-3: RESULT ↔ DETAIL wiring, fetch-on-demand, yourPlay/opponentPlay mapping.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { en } from '../src/i18n/en'
import { ja } from '../src/i18n/ja'

const [
  resultScreen,
  detailScreen,
  detailBoard,
  playScreen,
  bootstrap,
  coordinator,
  playClient,
  appCss,
  persistence,
  claimSource,
  capabilitySource,
  duelResultDomain,
] = await Promise.all([
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailScreen.tsx', 'utf8'),
  readFile('src/components/DuelMatchDetailBoard.tsx', 'utf8'),
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelClaimBootstrap.tsx', 'utf8'),
  readFile('src/duel/duelPlayCoordinator.ts', 'utf8'),
  readFile('src/duel/duelPlayClient.ts', 'utf8'),
  readFile('src/App.css', 'utf8'),
  readFile('src/duel/duelPersistence.ts', 'utf8'),
  readFile('src/duel/duelClaim.ts', 'utf8'),
  readFile('src/duel/duelParticipantCapability.ts', 'utf8'),
  readFile('src/duel/duelResult.ts', 'utf8').catch(() =>
    readFile('server/duel/duelResult.ts', 'utf8'),
  ),
])

const completedBlock = resultScreen.slice(
  resultScreen.indexOf('function CompletedResult'),
  resultScreen.indexOf('function CompletionShell'),
)
const completionShell = resultScreen.slice(
  resultScreen.indexOf('function CompletionShell'),
  resultScreen.indexOf('function DetailLoading') >= 0
    ? resultScreen.indexOf('function DetailLoading')
    : resultScreen.indexOf('export function DuelResultScreen'),
)

/* ①④ final RESULT only; button order */
assert.match(completedBlock, /t\.duelViewDetails/)
assert.match(completedBlock, /duel-final-view-details/)
assert.match(completedBlock, /t\.duelReturnToTop/)
assert.match(completedBlock, /t\.duelAddToHomeScreen/)
assert.ok(
  completedBlock.indexOf('t.duelViewDetails') <
    completedBlock.indexOf('t.duelReturnToTop') &&
    completedBlock.indexOf('t.duelReturnToTop') <
      completedBlock.indexOf('t.duelAddToHomeScreen'),
  'details → top → home-install',
)

/* ②③ waiting / result-ready have no VIEW DETAILS */
assert.doesNotMatch(completionShell, /duelViewDetails|duel-final-view-details|fetchDetail/)
assert.match(completionShell, /duelViewResult/)
assert.match(completionShell, /duelWaitingBody/)

/* ⑤⑥ fetch on VIEW DETAILS; double-request guard */
assert.match(resultScreen, /fetchDetailRef\.current/)
assert.match(resultScreen, /detailInFlightRef/)
assert.match(resultScreen, /if \(detailInFlightRef\.current\) return/)
assert.match(resultScreen, /setDetailPane\(\{ kind: 'loading' \}\)/)
assert.match(resultScreen, /kind: 'ready'/)
assert.match(resultScreen, /kind: 'error'/)
assert.match(playScreen, /fetchDetail=\{\(\) => coordinator\.getMatchDetail\(matchId\)\}/)
assert.match(bootstrap, /fetchDetail=\{\(\) => client\.getMatchDetail\(lockedResume\.matchId\)\}/)
assert.match(coordinator, /getMatchDetail\(matchId: string\): Promise<DuelMatchDetail>/)
assert.match(playClient, /async getMatchDetail/)
assert.match(playClient, /\/detail`/)

/* ⑦⑧⑨⑩⑪ DETAIL maps yourPlay / opponentPlay + boards */
assert.match(detailScreen, /export function DuelMatchDetailScreen/)
assert.match(detailScreen, /detail\.yourPlay\.rounds\.map/)
assert.match(detailScreen, /detail\.opponentPlay\.rounds\.map/)
assert.match(detailScreen, /data-duel-match-detail-side="you"/)
assert.match(detailScreen, /data-duel-match-detail-side="opponent"/)
assert.match(detailScreen, /t\.duelMatchDetailRound\(round\.roundNumber\)/)
assert.match(detailScreen, /<DuelMatchDetailBoard/)
assert.match(detailScreen, /bagCount=\{round\.bagCount\}/)
assert.match(detailScreen, /bombBagNumber=\{round\.bombBagNumber\}/)
assert.match(detailScreen, /coinBagNumbers=\{round\.coinBagNumbers\}/)
assert.match(detailScreen, /opens=\{round\.opens\}/)
assert.match(detailBoard, /export function DuelMatchDetailBoard/)

/* ⑫⑬ one detail response; no per-ROUND fetch */
assert.doesNotMatch(detailScreen, /fetch\(|getMatchDetail|getFinalResult|rounds\/.+\/reveal/)
assert.doesNotMatch(resultScreen, /for \(.*round.*\)[\s\S]*fetchDetail/s)
assert.match(resultScreen, /cachedDetailRef/)

/* ⑭⑮ back to RESULT; no capability wipe */
assert.match(detailScreen, /t\.duelBackToResult/)
assert.match(detailScreen, /onBackToResult/)
assert.match(resultScreen, /setDetailPane\(\{ kind: 'closed' \}\)/)
assert.doesNotMatch(resultScreen, /removeItem|clearParticipant|localStorage\.remove/)
assert.doesNotMatch(detailScreen, /removeItem|clearParticipant/)

/* ⑯⑰ error not drawn as detail; retry */
assert.match(resultScreen, /kind: 'error'/)
assert.match(resultScreen, /duelMatchDetailError/)
assert.match(resultScreen, /duelMatchDetailRetry/)
assert.match(resultScreen, /onRetry/)
assert.match(
  resultScreen,
  /catch \{\s*setDetailPane\(\{ kind: 'error' \}\)/s,
)

/* ⑱ no localStorage persistence of detail payload */
assert.doesNotMatch(resultScreen, /setItem\(|localStorage/)
assert.doesNotMatch(detailScreen, /setItem\(|localStorage/)
assert.doesNotMatch(persistence, /matchDetail|yourPlay|opponentPlay/)

/* ⑲⑳ capability / invite contracts untouched */
assert.match(claimSource, /#invite/)
assert.match(capabilitySource, /participant/)
assert.doesNotMatch(claimSource, /getMatchDetail|DuelMatchDetailScreen/)
assert.doesNotMatch(capabilitySource, /getMatchDetail|DuelMatchDetailScreen/)
assert.match(bootstrap, /DuelResultScreen/)
assert.match(bootstrap, /fetchDetail/)

/* ㉑㉒ standalone / no install CTA on DETAIL */
assert.doesNotMatch(detailScreen, /useHomeInstallCta|duelAddToHomeScreen|home-install/)
assert.match(completedBlock, /useHomeInstallCta/)

/* ㉓ scoring unchanged */
assert.match(duelResultDomain, /TOTAL COINS → 3COINS COMPLETE → BOMBS HIT/)
assert.match(duelResultDomain, /threeCoinsComplete/)
assert.match(resultScreen, /duelThreeCoinsComplete/)
assert.match(resultScreen, /duelTotalCoins/)
assert.match(resultScreen, /duelBombsHit/)

/* ㉔ 40 ROUND capable structure (map both sides; no virtualization) */
assert.match(detailScreen, /\.map\(/)
assert.doesNotMatch(detailScreen, /virtual|VirtualList|accordion|pagination|lazy\(/i)
assert.match(appCss, /\.duel-match-detail\s*{[^}]*overflow-x:\s*hidden/s)
assert.match(appCss, /\.duel-match-detail\s*{[^}]*max-width:\s*100%/s)
assert.match(appCss, /width:\s*min\(100%,\s*20rem\)/)
assert.doesNotMatch(
  appCss.match(/\.duel-match-detail\s*\{[^}]*\}/s)?.[0] ?? '',
  /overflow-y/,
)
assert.match(
  appCss,
  /\.group-result-detail__rounds\s*\{[\s\S]*?overflow-y:\s*auto/,
)

/* i18n */
assert.equal(ja.duelViewDetails, '詳細をみる')
assert.equal(en.duelViewDetails, 'VIEW DETAILS')
assert.equal(ja.duelMatchDetails, '対戦詳細')
assert.equal(en.duelMatchDetails, 'MATCH DETAILS')
assert.equal(ja.duelBackToResult, '結果へ戻る')
assert.equal(en.duelBackToResult, 'BACK TO RESULT')
assert.equal(ja.duelMatchDetailLoading, '読み込み中…')
assert.equal(en.duelMatchDetailLoading, 'LOADING…')
assert.equal(ja.duelMatchDetailError, '詳細を読み込めませんでした')
assert.equal(en.duelMatchDetailError, 'Could not load details.')
assert.equal(ja.duelMatchDetailRetry, '再試行')
assert.equal(en.duelMatchDetailRetry, 'RETRY')
assert.equal(ja.duelMatchDetailRound(7), 'ROUND 7')
assert.equal(en.duelMatchDetailRound(7), 'ROUND 7')
assert.equal(ja.duelYou, 'あなた')
assert.equal(en.duelYou, 'YOU')
assert.equal(ja.duelOpponent, '相手')
assert.equal(en.duelOpponent, 'OPPONENT')

/* Existing EN RESULT copy untouched */
assert.equal(en.duelViewResult, 'VIEW RESULT')
assert.equal(en.duelReturnToTop, 'BACK TO TOP')
assert.equal(en.duelAddToHomeScreen, 'ADD TO HOME SCREEN')
assert.equal(en.duelThreeCoinsComplete, '3COINS COMPLETE')

console.log('verify:duel-match-detail-screen OK')
