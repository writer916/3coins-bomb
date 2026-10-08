/**
 * Phase-3: RESULT ↔ DETAIL wiring, fetch-on-demand, yourPlay/opponentPlay mapping.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildDuelMatchDetailView } from '../src/duel/duelMatchDetailPresentation'
import type {
  DuelFinalResult,
  DuelMatchDetail,
  DuelResultParticipantSummary,
  DuelResultRole,
} from '../src/duel/duelPlayClient'
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

function summary(role: DuelResultRole, totalRounds: number): DuelResultParticipantSummary {
  const rounds = Array.from({ length: totalRounds }, (_, index) => {
    const endReason = (index + (role === 'A' ? 0 : 1)) % 3 === 0
      ? 'bombed' as const
      : (index + (role === 'A' ? 0 : 1)) % 3 === 1
        ? 'cashed_out' as const
        : 'cleared' as const
    return {
      roundNumber: index + 1,
      endReason,
      capturedCoins: (endReason === 'bombed' ? 0 : endReason === 'cashed_out' ? 2 : 3) as 0 | 2 | 3,
      openedBagCount: (index % 3) + 1,
    }
  })
  return {
    role,
    totalCapturedCoins: rounds.reduce((sum, round) => sum + round.capturedCoins, 0),
    threeCoinsComplete: rounds.filter((round) => round.endReason === 'cleared').length,
    bombsHit: 0,
    coinBagHits: 0,
    totalOpens: rounds.reduce((sum, round) => sum + round.openedBagCount, 0),
    hitRate: { numerator: 0, denominator: rounds.reduce((sum, round) => sum + round.openedBagCount, 0) },
    rounds,
  }
}

function completedResult(viewerRole: DuelResultRole, totalRounds: number) {
  return {
    matchId: '00000000-0000-4000-8000-000000000001',
    status: 'completed',
    viewerRole,
    totalRounds,
    winner: 'draw',
    participants: { A: summary('A', totalRounds), B: summary('B', totalRounds) },
  } satisfies Extract<DuelFinalResult, { status: 'completed' }>
}

function matchDetail(
  result: Extract<DuelFinalResult, { status: 'completed' }>,
): DuelMatchDetail {
  const otherRole = result.viewerRole === 'A' ? 'B' : 'A'
  const play = (role: DuelResultRole) => ({
    rounds: result.participants[role].rounds.map((round) => ({
      roundNumber: round.roundNumber,
      bagCount: 8,
      bombBagNumber: 8,
      coinBagNumbers: [1, 2, 3],
      opens: Array.from({ length: round.openedBagCount }, (_, index) => ({
        openOrder: index + 1,
        bagNumber: index + 1,
      })),
    })),
  })
  return {
    matchId: result.matchId,
    status: 'completed',
    viewerRole: result.viewerRole,
    totalRounds: result.totalRounds,
    yourPlay: play(result.viewerRole),
    opponentPlay: play(otherRole),
  }
}

/* RESULT summaries join to the correct viewer side for 1 / 2 / 20 ROUNDS. */
for (const totalRounds of [1, 2, 20]) {
  for (const viewerRole of ['A', 'B'] as const) {
    const result = completedResult(viewerRole, totalRounds)
    const detail = matchDetail(result)
    const view = buildDuelMatchDetailView(detail, result)
    const otherRole = viewerRole === 'A' ? 'B' : 'A'
    assert.equal(view.yourRounds.length, totalRounds)
    assert.equal(view.opponentRounds.length, totalRounds)
    assert.deepEqual(
      view.yourRounds.map(({ roundNumber, endReason, capturedCoins, openedBagCount }) =>
        ({ roundNumber, endReason, capturedCoins, openedBagCount })),
      result.participants[viewerRole].rounds,
    )
    assert.deepEqual(
      view.opponentRounds.map(({ roundNumber, endReason, capturedCoins, openedBagCount }) =>
        ({ roundNumber, endReason, capturedCoins, openedBagCount })),
      result.participants[otherRole].rounds,
    )
  }
}

const validResult = completedResult('A', 2)
const validDetail = matchDetail(validResult)
assert.throws(() => buildDuelMatchDetailView({ ...validDetail, matchId: 'other' }, validResult))
assert.throws(() => buildDuelMatchDetailView({ ...validDetail, viewerRole: 'B' }, validResult))
assert.throws(() => buildDuelMatchDetailView({ ...validDetail, totalRounds: 1 }, validResult))
assert.throws(() => buildDuelMatchDetailView(validDetail, {
  ...validResult,
  participants: {
    ...validResult.participants,
    A: { ...validResult.participants.A, role: 'B' },
  },
}))
assert.throws(() => buildDuelMatchDetailView({
  ...validDetail,
  yourPlay: { rounds: validDetail.yourPlay.rounds.slice(0, 1) },
}, validResult))
assert.throws(() => buildDuelMatchDetailView({
  ...validDetail,
  opponentPlay: {
    rounds: validDetail.opponentPlay.rounds.map((round, index) =>
      index === 0 ? { ...round, opens: [] } : round),
  },
}, validResult))
assert.throws(() => buildDuelMatchDetailView({
  ...validDetail,
  yourPlay: {
    rounds: validDetail.yourPlay.rounds.map((round, index) =>
      index === 0 ? { ...round, roundNumber: 2 } : round),
  },
}, validResult))
assert.throws(() => buildDuelMatchDetailView({
  ...validDetail,
  yourPlay: {
    rounds: validDetail.yourPlay.rounds.map((round, index) =>
      index === 0 ? { ...round, opens: [] } : round),
  },
}, validResult))

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
assert.match(detailScreen, /detail\.yourRounds\.map/)
assert.match(detailScreen, /detail\.opponentRounds\.map/)
assert.match(detailScreen, /data-duel-match-detail-side="you"/)
assert.match(detailScreen, /data-duel-match-detail-side="opponent"/)
assert.match(detailScreen, /t\.duelMatchDetailRound\(round\.roundNumber\)/)
assert.match(detailScreen, /<DuelMatchDetailBoard/)
assert.match(detailScreen, /bagCount=\{round\.bagCount\}/)
assert.match(detailScreen, /bombBagNumber=\{round\.bombBagNumber\}/)
assert.match(detailScreen, /coinBagNumbers=\{round\.coinBagNumbers\}/)
assert.match(detailScreen, /opens=\{round\.opens\}/)
assert.match(detailScreen, /round\.capturedCoins/)
assert.match(detailScreen, /round\.openedBagCount/)
assert.match(detailScreen, /groupRoundBombed/)
assert.match(detailScreen, /groupRoundCashedOut/)
assert.match(detailScreen, /duelThreeCoinsComplete/)
assert.match(detailBoard, /export function DuelMatchDetailBoard/)
assert.match(resultScreen, /buildDuelMatchDetailView\(detail, result\)/)

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
assert.match(
  appCss,
  /\.match-detail-round__head\s*\{[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?align-items:\s*baseline[\s\S]*?justify-content:\s*space-between/,
)
assert.match(
  appCss,
  /\.match-detail-round__label,\s*\.match-detail-round__end\s*\{[\s\S]*?color:\s*#f2e6d0[\s\S]*?font-size:\s*clamp\(0\.95rem,\s*3\.6vw,\s*1\.1rem\)[\s\S]*?font-weight:\s*700[\s\S]*?line-height:\s*1\.1[\s\S]*?white-space:\s*nowrap/,
)
assert.doesNotMatch(
  appCss,
  /\.duel-match-detail__round-label\s*\{/,
)
assert.match(
  appCss,
  /\.match-detail-round__stats p\s*\{[\s\S]*?white-space:\s*nowrap/,
)
assert.match(
  appCss,
  /\.match-detail-round__stats\s*\{[\s\S]*?justify-content:\s*flex-end[\s\S]*?width:\s*100%/,
)
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
assert.equal(ja.detailCapturedCoins, 'COINS')
assert.equal(en.detailCapturedCoins, 'COINS')
assert.equal(ja.detailOpenedBags, 'OPEN')
assert.equal(en.detailOpenedBags, 'OPEN')
assert.equal(ja.groupRoundBombed, 'BOMB')
assert.equal(en.groupRoundBombed, 'BOMB')
assert.equal(ja.groupRoundCashedOut, 'CASH OUT')
assert.equal(en.groupRoundCashedOut, 'CASH OUT')
assert.equal(ja.duelThreeCoinsComplete, '3COINS COMPLETE')
assert.equal(en.duelThreeCoinsComplete, '3COINS COMPLETE')

/* ROUND 20 + longest end reason fit one header row at supported phone widths. */
for (const viewportWidth of [320, 360, 375, 390, 768, 1280]) {
  const detailContentWidth = viewportWidth - 1.3 * 16
  const estimatedRoundLabel = 5.2 * 17.6
  const estimatedEndReason = 8.2 * 17.6
  const headerGap = 0.75 * 16
  assert.ok(
    estimatedRoundLabel + estimatedEndReason + headerGap < detailContentWidth,
    `${viewportWidth}px detail header must fit one row`,
  )
}

for (const roundNumber of [1, 9, 10, 20]) {
  assert.equal(ja.duelMatchDetailRound(roundNumber), `ROUND ${roundNumber}`)
  assert.equal(en.duelMatchDetailRound(roundNumber), `ROUND ${roundNumber}`)
}

/* Existing EN RESULT copy untouched */
assert.equal(en.duelViewResult, 'VIEW RESULT')
assert.equal(en.duelReturnToTop, 'BACK TO TOP')
assert.equal(en.duelAddToHomeScreen, 'ADD TO HOME SCREEN')
assert.equal(en.duelThreeCoinsComplete, '3COINS COMPLETE')

console.log('verify:duel-match-detail-screen OK')
