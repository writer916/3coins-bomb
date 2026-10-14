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
  dailyResultViewModel,
  formatDailyResultHitRate,
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
  rounds: [],
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
assert.equal(loadingRankVm.statusKey, 'none')
assert.equal(loadingRankVm.showSelfScores, true)
assert.equal(loadingRankVm.showRankingRetry, false)
assert.equal(loadingRankVm.rows[0]!.totalCoins, 12)

const pendingVm = dailyResultViewModel({
  kind: 'ranking_pending',
  self: selfView,
})
assert.equal(pendingVm.statusKey, 'dailyRankingUpdatesEvery10Minutes')
assert.equal(
  en.dailyRankingUpdatesEvery10Minutes,
  'RANKING UPDATES EVERY 10 MINUTES',
)
assert.equal(pendingVm.showSelfScores, true)
assert.equal(pendingVm.showRankingRetry, true)
assert.equal(pendingVm.rows[0]!.totalCoins, 12)
assert.equal(pendingVm.rows[0]!.rank, null)
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
assert.match(app, /onChallengeComplete/)
assert.match(app, /state\.completedAt/)
assert.match(app, /challengeDate: state\.challengeDate/)

const play = readFileSync(
  resolve(root, 'src/components/DailyPlayScreen.tsx'),
  'utf8',
)
assert.match(play, /onChallengeComplete/)
assert.match(play, /play\.completedAt/)
assert.match(play, /fx !== null \|\| requestPending/)
assert.match(play, /dailyChallengeComplete/)
assert.match(play, /challengeCompleteNotifiedRef/)

const resultScreen = readFileSync(
  resolve(root, 'src/components/DailyResultScreen.tsx'),
  'utf8',
)
assert.match(resultScreen, /group-result/)
assert.match(resultScreen, /fetchDailySelfResult/)
assert.match(resultScreen, /fetchDailyRanking/)
assert.match(resultScreen, /ranking_pending/)
assert.match(resultScreen, /ranking_loading/)
assert.match(resultScreen, /dailyResultViewModel/)
assert.match(resultScreen, /dailyRankingUpdatesEvery10Minutes/)
assert.doesNotMatch(resultScreen, /groupViewDetails/)
assert.doesNotMatch(resultScreen, /totalTimeSeconds/)
assert.match(resultScreen, /Details column reserved for eng9D/)
assert.match(resultScreen, /cancelled/)
assert.doesNotMatch(resultScreen, /challengeDateRef\.current\s*=/)

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
const presentation = readFileSync(
  resolve(root, 'src/daily/dailyResultPresentation.ts'),
  'utf8',
)
assert.match(presentation, /dailyRankingUpdatesEvery10Minutes/)
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

console.log('verify:daily-result-ui OK')
