/**
 * DAILY RESULT／RANKING list UI (eng9C) — client, presentation, wiring.
 * No real DB. Does not import .tsx (tsx classic JSX); covers state transitions
 * via dailyResultViewModel + fetch mocks + source wiring of App/Play/Screen.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DailyRankingClientError,
  fetchDailyRanking,
  fetchDailySelfResult,
  parseDailyRanking,
  parseDailySelfResult,
} from '../src/daily/dailyRankingClient.ts'
import {
  buildDailyResultListRows,
  buildDailyResultPendingSelfRow,
  classifyDailyRankingLoadFailure,
  dailyResultRankSizeClass,
  dailyResultStatusPresentation,
  dailyResultViewModel,
  formatDailyResultHitRate,
  shouldSeparateDailySelfRow,
} from '../src/daily/dailyResultPresentation.ts'
import { en } from '../src/i18n/en.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2026-10-14'
const SELF = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const TWIN = '33333333-3333-4333-8333-333333333333'
const TOKEN = `3cb_dp1_${'A'.repeat(43)}`

function entry(
  participantId: string,
  rank: number,
  nickname: string,
  isSelf: boolean,
  scores: Partial<{
    totalCoins: number
    threeCoinsComplete: number
    coinBagHits: number
    totalOpens: number
  }> = {},
) {
  const totalOpens = scores.totalOpens ?? 4
  const coinBagHits = scores.coinBagHits ?? 2
  return {
    participantId,
    rank,
    nickname,
    totalCoins: scores.totalCoins ?? 10,
    threeCoinsComplete: scores.threeCoinsComplete ?? 2,
    coinBagHits,
    totalOpens,
    coinBagHitRate: { numerator: coinBagHits, denominator: totalOpens },
    isSelf,
  }
}

function boardRound(roundNumber: number) {
  return {
    roundNumber,
    endReason: 'timed_out' as const,
    capturedCoins: 0 as const,
    openedBagCount: 0,
    coinBagHits: 0,
    elapsedSeconds: 60,
    bagCount: 8,
    bombBagNumber: 8,
    coinBagNumbers: [1, 2, 3] as [number, number, number],
    opens: [] as const,
  }
}

const selfResultBody = {
  challengeDate: date,
  participantId: SELF,
  nickname: 'SelfPlayer',
  acceptedAt: '2026-10-14T00:05:00.000Z',
  completedAt: '2026-10-14T12:15:00.000Z',
  totalCoins: 12,
  threeCoinsComplete: 3,
  coinBagHits: 5,
  totalOpens: 10,
  coinBagHitRate: { numerator: 5, denominator: 10 },
  totalTimeSeconds: 400,
  rounds: Array.from({ length: 20 }, (_, i) => boardRound(i + 1)),
}

const selfView = parseDailySelfResult(selfResultBody, date)
assert.equal(selfView.totalCoins, 12)
assert.throws(() => parseDailySelfResult(selfResultBody, '2026-10-13'))

const rankingInTop = parseDailyRanking(
  {
    challengeDate: date,
    status: 'provisional',
    rankingAsOf: '2026-10-14T12:20:00.000Z',
    topEntries: [
      entry(OTHER, 1, 'Other', false, { totalCoins: 20 }),
      entry(SELF, 2, 'SelfPlayer', true, { totalCoins: 12 }),
    ],
    self: entry(SELF, 2, 'SelfPlayer', true, { totalCoins: 12 }),
    selfInTop: true,
    totalRankedParticipants: 2,
  },
  date,
)
const rowsInTop = buildDailyResultListRows(rankingInTop)
assert.equal(rowsInTop.length, 2)
assert.equal(rowsInTop.filter((r) => r.isSelf).length, 1)
assert.equal(rowsInTop[1]!.key, SELF)

const topTen = Array.from({ length: 10 }, (_, i) =>
  entry(
    `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    i + 1,
    `Top${i}`,
    false,
    { totalCoins: 30 - i },
  ),
)
const rankingOut = parseDailyRanking(
  {
    challengeDate: date,
    status: 'final',
    rankingAsOf: '2026-10-15T00:00:00.000Z',
    topEntries: topTen,
    self: entry(SELF, 24, 'SelfPlayer', true, { totalCoins: 12 }),
    selfInTop: false,
    totalRankedParticipants: 40,
  },
  date,
)
const rowsOut = buildDailyResultListRows(rankingOut)
assert.equal(rowsOut.length, 11)
assert.equal(rowsOut[10]!.isSelf, true)
assert.equal(rowsOut[10]!.rank, 24)
assert.ok(!rowsOut.slice(0, 10).some((r) => r.isSelf))
assert.equal(shouldSeparateDailySelfRow(rowsOut, 10), true)
assert.equal(shouldSeparateDailySelfRow(rowsInTop, 1), false)
assert.equal(dailyResultRankSizeClass(1), '')
assert.equal(dailyResultRankSizeClass(10), '')
assert.equal(dailyResultRankSizeClass(11), '')
assert.equal(dailyResultRankSizeClass(58), '')
assert.equal(dailyResultRankSizeClass(123), ' daily-result__rank--3')
assert.equal(dailyResultRankSizeClass(1234), ' daily-result__rank--4')
assert.equal(dailyResultRankSizeClass(12345), ' daily-result__rank--5-plus')
assert.equal(dailyResultRankSizeClass(123456), ' daily-result__rank--5-plus')

const twinRanking = parseDailyRanking(
  {
    challengeDate: date,
    status: 'provisional',
    rankingAsOf: '2026-10-14T12:20:00.000Z',
    topEntries: [
      entry(TWIN, 1, 'SelfPlayer', false),
      entry(SELF, 2, 'SelfPlayer', true),
    ],
    self: entry(SELF, 2, 'SelfPlayer', true),
    selfInTop: true,
    totalRankedParticipants: 2,
  },
  date,
)
assert.equal(twinRanking.topEntries[0]!.isSelf, false)
assert.equal(twinRanking.topEntries[1]!.isSelf, true)

const tied = parseDailyRanking(
  {
    challengeDate: date,
    status: 'provisional',
    rankingAsOf: '2026-10-14T12:20:00.000Z',
    topEntries: [
      entry(OTHER, 1, 'A', false),
      entry(TWIN, 1, 'B', false),
      entry(SELF, 3, 'SelfPlayer', true),
    ],
    self: entry(SELF, 3, 'SelfPlayer', true),
    selfInTop: true,
    totalRankedParticipants: 3,
  },
  date,
)
assert.deepEqual(
  buildDailyResultListRows(tied).map((r) => r.rank),
  [1, 1, 3],
)

assert.throws(() =>
  parseDailyRanking(
    {
      challengeDate: date,
      status: 'provisional',
      rankingAsOf: '2026-10-14T12:20:00.000Z',
      topEntries: [entry(SELF, 1, 'SelfPlayer', true)],
      self: entry(SELF, 1, 'SelfPlayer', true),
      selfInTop: true,
      totalRankedParticipants: 1,
      totalTimeSeconds: 99,
    },
    date,
  ),
)

assert.equal(classifyDailyRankingLoadFailure('UNAVAILABLE'), 'pending')
assert.equal(classifyDailyRankingLoadFailure('NETWORK'), 'error')
assert.equal(classifyDailyRankingLoadFailure('UNAUTHORIZED'), 'unauthorized')
assert.equal(formatDailyResultHitRate(0, 0), '0%')

const pendingRow = buildDailyResultPendingSelfRow(selfView)
assert.equal(pendingRow.rank, null)
assert.equal(pendingRow.totalCoins, 12)

// --- UI state transitions (view model) ---
const loadingVm = dailyResultViewModel({ kind: 'loading_self' })
assert.equal(loadingVm.statusKey, 'groupResultLoading')
assert.equal(loadingVm.showSelfScores, false)
assert.equal(en[loadingVm.statusKey], en.groupResultLoading)

const loadingRankVm = dailyResultViewModel({
  kind: 'ranking_loading',
  self: selfView,
})
assert.equal(loadingRankVm.statusKey, 'groupResultLoading')
assert.equal(loadingRankVm.showSelfScores, false)
assert.equal(loadingRankVm.showRankingRetry, false)
assert.equal(loadingRankVm.rows.length, 0)

const pendingVm = dailyResultViewModel({
  kind: 'ranking_pending',
  self: selfView,
})
assert.equal(pendingVm.statusKey, 'dailyRankingUpdatesEvery10Minutes')
assert.equal(
  en.dailyRankingUpdatesEvery10Minutes,
  'RANKING UPDATES EVERY 10 MINUTES',
)
assert.equal(pendingVm.showSelfScores, false)
assert.equal(pendingVm.showRankingRetry, true)
assert.equal(pendingVm.rows.length, 0)
// 404 pending must NOT use fault or generic LOADING copy
assert.notEqual(pendingVm.statusKey, 'groupResultError')
assert.notEqual(pendingVm.statusKey, 'groupResultLoading')

const readyVm = dailyResultViewModel({
  kind: 'ready',
  self: selfView,
  ranking: rankingOut,
})
assert.equal(readyVm.statusKey, 'none')
assert.equal(readyVm.rows.length, 11)
assert.equal(readyVm.showRankingRetry, false)
assert.equal(readyVm.rows.filter((r) => r.isSelf).length, 1)

assert.equal(en.dailyProvisionalResultTitle, 'PROVISIONAL RESULT')
assert.equal(
  en.dailyProvisionalResultDescription('9:00 JST'),
  'Rankings update every 10 minutes and become final at 9:00 JST (00:00 UTC).',
)
assert.equal(en.dailyFinalResultTitle, 'FINAL RESULT')

const provisionalPresentation = dailyResultStatusPresentation({
  kind: 'ready',
  self: selfView,
  ranking: { ...rankingOut, status: 'provisional' },
})
assert.equal(provisionalPresentation.titleKey, 'dailyProvisionalResultTitle')
assert.equal(
  provisionalPresentation.descriptionKey,
  'dailyProvisionalResultDescription',
)
const finalPresentation = dailyResultStatusPresentation({
  kind: 'ready',
  self: selfView,
  ranking: { ...rankingOut, status: 'final' },
})
assert.equal(finalPresentation.titleKey, 'dailyFinalResultTitle')
assert.equal(finalPresentation.descriptionKey, null)
for (const phase of [
  { kind: 'ranking_loading', self: selfView } as const,
  { kind: 'ranking_pending', self: selfView } as const,
  { kind: 'ranking_error', self: selfView, code: 'error' } as const,
]) {
  assert.deepEqual(dailyResultStatusPresentation(phase), {
    titleKey: 'groupResultTitle',
    descriptionKey: null,
  })
}
assert.deepEqual(
  dailyResultStatusPresentation({
    kind: 'ready',
    self: selfView,
    ranking: { ...rankingOut, status: 'provisional' },
    refreshError: true,
  }),
  provisionalPresentation,
)

const rankErrVm = dailyResultViewModel({
  kind: 'ranking_error',
  self: selfView,
  code: 'error',
})
assert.equal(rankErrVm.statusKey, 'groupResultError')
assert.equal(rankErrVm.showSelfScores, true)
assert.equal(rankErrVm.rows[0]!.totalCoins, 12)

const authVm = dailyResultViewModel({ kind: 'self_error', code: 'unauthorized' })
assert.equal(authVm.showSelfScores, false)
assert.equal(authVm.showRankingRetry, false)

const selfErrRetry = dailyResultViewModel({ kind: 'self_error', code: 'error' })
assert.equal(selfErrRetry.showRankingRetry, true)

// --- fetch: RESULT immediate; ranking 404 then 200 ---
let rankingCalls = 0
const fetchMock: typeof fetch = async (input) => {
  const url = String(input)
  if (url.includes('/result')) {
    return new Response(JSON.stringify(selfResultBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (url.includes('/ranking')) {
    rankingCalls += 1
    if (rankingCalls === 1) {
      return new Response(
        JSON.stringify({ error: { code: 'ranking_unavailable' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        challengeDate: date,
        status: 'provisional',
        rankingAsOf: '2026-10-14T12:20:00.000Z',
        topEntries: [
          entry(OTHER, 1, 'Other', false, { totalCoins: 20 }),
          entry(SELF, 2, 'SelfPlayer', true, { totalCoins: 12 }),
        ],
        self: entry(SELF, 2, 'SelfPlayer', true, { totalCoins: 12 }),
        selfInTop: true,
        totalRankedParticipants: 2,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return new Response('missing', { status: 404 })
}

const fetchedSelf = await fetchDailySelfResult(date, TOKEN, fetchMock)
assert.equal(fetchedSelf.totalCoins, 12)
await assert.rejects(
  () => fetchDailyRanking(date, TOKEN, fetchMock),
  (e: unknown) =>
    e instanceof DailyRankingClientError && e.code === 'UNAVAILABLE',
)
assert.equal(classifyDailyRankingLoadFailure('UNAVAILABLE'), 'pending')
const fetchedRanking = await fetchDailyRanking(date, TOKEN, fetchMock)
assert.equal(fetchedRanking.selfInTop, true)

let immediateUrl = ''
await fetchDailyRanking(
  date,
  TOKEN,
  async (input) => {
    immediateUrl = String(input)
    return new Response(JSON.stringify({
      challengeDate: date,
      status: 'provisional',
      rankingAsOf: '2026-10-14T12:17:00.000Z',
      topEntries: [entry(SELF, 1, 'SelfPlayer', true)],
      self: entry(SELF, 1, 'SelfPlayer', true),
      selfInTop: true,
      totalRankedParticipants: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  },
  'immediate',
)
assert.match(immediateUrl, /\/ranking\?snapshot=immediate$/)

await assert.rejects(
  () =>
    fetchDailySelfResult(date, TOKEN, async () => new Response('', { status: 401 })),
  (e: unknown) =>
    e instanceof DailyRankingClientError && e.code === 'UNAUTHORIZED',
)

await assert.rejects(
  () =>
    fetchDailyRanking(date, TOKEN, async () =>
      new Response(
        JSON.stringify({
          challengeDate: '2026-10-15',
          status: 'final',
          rankingAsOf: '2026-10-16T00:00:00.000Z',
          topEntries: [entry(SELF, 1, 'SelfPlayer', true)],
          self: entry(SELF, 1, 'SelfPlayer', true),
          selfInTop: true,
          totalRankedParticipants: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  (e: unknown) =>
    e instanceof DailyRankingClientError && e.code === 'INVALID_RESPONSE',
)

// Simulate screen load sequence: self first → pending on 404 → ready on retry
async function simulateScreenLoad(fetcher: typeof fetch): Promise<string[]> {
  const phases: string[] = ['loading_self']
  const self = await fetchDailySelfResult(date, TOKEN, fetcher)
  phases.push('self_ready')
  try {
    await fetchDailyRanking(date, TOKEN, fetcher)
    phases.push('ready')
  } catch (error: unknown) {
    if (
      error instanceof DailyRankingClientError &&
      classifyDailyRankingLoadFailure(error.code) === 'pending'
    ) {
      phases.push('ranking_pending')
      const ranking = await fetchDailyRanking(date, TOKEN, fetcher)
      assert.equal(ranking.challengeDate, date)
      phases.push('ready')
    } else {
      phases.push('ranking_error')
    }
  }
  assert.equal(self.challengeDate, date)
  return phases
}

rankingCalls = 0
assert.deepEqual(await simulateScreenLoad(fetchMock), [
  'loading_self',
  'self_ready',
  'ranking_pending',
  'ready',
])

// --- Source wiring / non-regression ---
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
assert.match(app, /DailyResultScreen/)
assert.match(app, /kind: 'result'/)
assert.match(app, /onShowResult/)
assert.match(app, /state\.completedAt/)
assert.match(app, /challengeDate: state\.challengeDate/)

const play = readFileSync(
  resolve(root, 'src/components/DailyPlayScreen.tsx'),
  'utf8',
)
assert.match(play, /onShowResult/)
assert.match(play, /play\.completedAt/)
assert.match(play, /canOpenDailyResult/)
assert.match(play, /dailyChallengeComplete/)
assert.doesNotMatch(play, /challengeCompleteNotifiedRef/)

const resultScreen = readFileSync(
  resolve(root, 'src/components/DailyResultScreen.tsx'),
  'utf8',
)
assert.match(resultScreen, /group-result/)
assert.match(resultScreen, /fetchDailySelfResult/)
assert.match(resultScreen, /fetchDailyRanking/)
assert.match(resultScreen, /fetchDailyRanking\([\s\S]*?'immediate'/)
assert.match(resultScreen, /ranking_pending/)
assert.match(resultScreen, /ranking_loading/)
assert.match(resultScreen, /dailyResultViewModel/)
assert.match(resultScreen, /dailyRankingUpdatesEvery10Minutes/)
assert.match(resultScreen, /dailyResultStatusPresentation\(phase\)/)
assert.match(resultScreen, /groupViewDetails/)
assert.match(resultScreen, /DailyResultDetailScreen/)
assert.match(resultScreen, /data-daily-result-detail-button/)
assert.doesNotMatch(resultScreen, /totalTimeSeconds/)
assert.match(resultScreen, /cancelled/)
assert.doesNotMatch(resultScreen, /challengeDateRef\.current\s*=/)
assert.match(resultScreen, /msUntilNextDailyRankingRefresh/)
assert.match(resultScreen, /visibilitychange/)
assert.doesNotMatch(resultScreen, /setInterval\(\s*[^,]+,\s*600_?000/)
assert.match(resultScreen, /groupResultRetry/)
assert.match(resultScreen, /data-daily-result-retry/)
assert.match(resultScreen, /handleRetry/)
assert.doesNotMatch(resultScreen, /data-daily-ranking-retry/)

const detailScreen = readFileSync(
  resolve(root, 'src/components/DailyResultDetailScreen.tsx'),
  'utf8',
)
assert.match(detailScreen, /DuelMatchDetailBoard/)
assert.match(detailScreen, /groupBackToResult/)
assert.doesNotMatch(detailScreen, /elapsedSeconds|totalTime/i)

const groupResult = readFileSync(
  resolve(root, 'src/components/GroupResultScreen.tsx'),
  'utf8',
)
assert.match(groupResult, /groupViewDetails/)
assert.match(groupResult, /openDetails/)

const enSource = readFileSync(resolve(root, 'src/i18n/en.ts'), 'utf8')
assert.match(
  enSource,
  /dailyRankingUpdatesEvery10Minutes:\s*'RANKING UPDATES EVERY 10 MINUTES'/,
)
assert.equal(
  (enSource.match(/RANKING UPDATES EVERY 10 MINUTES/g) ?? []).length,
  1,
)
const jaSource = readFileSync(resolve(root, 'src/i18n/ja.ts'), 'utf8')
assert.match(
  jaSource,
  /dailyRankingUpdatesEvery10Minutes:\s*'RANKING UPDATES EVERY 10 MINUTES'/,
)
assert.match(enSource, /dailyProvisionalResultTitle:\s*'PROVISIONAL RESULT'/)
assert.match(
  enSource,
  /dailyProvisionalResultDescription:\s*\(localFinalTime\)\s*=>/,
)
assert.match(enSource, /dailyFinalResultTitle:\s*'FINAL RESULT'/)
assert.match(jaSource, /dailyProvisionalResultTitle:\s*'暫定結果'/)
assert.match(
  jaSource,
  /dailyProvisionalResultDescription:\s*\(localFinalTime\)\s*=>/,
)
assert.match(jaSource, /dailyFinalResultTitle:\s*'最終結果'/)
const presentation = readFileSync(
  resolve(root, 'src/daily/dailyResultPresentation.ts'),
  'utf8',
)
assert.match(presentation, /dailyRankingUpdatesEvery10Minutes/)
assert.match(presentation, /phase\.ranking\.status === 'provisional'/)
assert.doesNotMatch(
  presentation,
  /kind === 'ranking_pending'[\s\S]{0,200}groupDetailLoading/,
)
assert.match(
  readFileSync(resolve(root, 'src/i18n/types.ts'), 'utf8'),
  /dailyRankingUpdatesEvery10Minutes/,
)

assert.match(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
  /verify:daily-result-ui/,
)

assert.match(
  readFileSync(resolve(root, 'src/App.css'), 'utf8'),
  /daily-result__status/,
)
const appCss = readFileSync(resolve(root, 'src/App.css'), 'utf8')
assert.match(appCss, /\.daily-result__title[\s\S]*?white-space:\s*nowrap/)
assert.match(appCss, /\.daily-result__provisional-note/)
assert.match(appCss, /\.daily-result__heading[\s\S]*?min-height:/)
assert.match(appCss, /\.daily-result__entry--separated-self[\s\S]*?margin-top:\s*7\.2rem/)
assert.match(appCss, /\.daily-result \.group-result__rank[\s\S]*?text-align:\s*right/)
assert.match(appCss, /\.daily-result__rank--3/)
assert.match(appCss, /\.daily-result__rank--4/)
assert.match(appCss, /\.daily-result__rank--5-plus/)
assert.match(
  appCss,
  /\.group-result__cols > \*[\s\S]*?min-width:\s*0[\s\S]*?\.group-result__nickname[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
)
assert.match(
  appCss,
  /\.daily-result \.group-result__nickname[\s\S]*?padding-inline-start:\s*0\.5ch/,
)
assert.match(resultScreen, /formatDailyRankingFinalTime\(challengeDate, locale\)/)

console.log('verify:daily-result-ui OK')
