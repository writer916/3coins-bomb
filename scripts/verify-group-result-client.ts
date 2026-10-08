import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createGroupPlayClient,
  parseGroupResult,
  parseGroupResultDetail,
} from '../src/group/groupPlayClient'
import {
  formatGroupHitRate,
  formatGroupOpenReveal,
  formatGroupRoundEndReason,
} from '../src/group/groupResultPresentation'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')
const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'
const TOKEN = `3cb_gp1_${'A'.repeat(43)}`
const entry = (rank: number, nickname: string, entryKey: string, isSelf = false) => ({
  rank,
  entryKey,
  nickname,
  isSelf,
  totalCoins: 6,
  threeCoinsComplete: 2,
  coinBagHits: 2,
  totalOpens: 3,
  coinBagHitRate: { numerator: 2, denominator: 3 },
})
const keyAt = (index: number) =>
  `${'ABCDEFGHIJKLMNOPQRSTUV'.slice(0, 20)}${String(index).padStart(2, '0')}`
const response = {
  groupId: GROUP_ID,
  totalRounds: 2,
  playerLimit: 20,
  acceptedCount: 20,
  completedCount: 20,
  status: 'closed',
  ranking: Array.from({ length: 20 }, (_, index) =>
    entry(
      index < 2 ? 1 : index + 1,
      index === 0 ? '山田' : index === 1 ? 'Alice' : `Player${index + 1}`,
      keyAt(index),
      index === 0,
    ),
  ),
}
const parsed = parseGroupResult(response, GROUP_ID)
assert.equal(parsed.ranking.length, 20)
assert.deepEqual(parsed.ranking.map((x) => x.rank).slice(0, 4), [1, 1, 3, 4])
assert.equal(parsed.ranking[0]?.nickname, '山田')
assert.equal(parsed.ranking[0]?.entryKey, keyAt(0))
assert.equal(formatGroupHitRate(0, 0), '0%')
assert.equal(formatGroupHitRate(1, 2), '50%')
assert.equal(formatGroupHitRate(2, 3), '66.7%')
assert.equal(formatGroupHitRate(3, 3), '100%')
assert.equal(
  parseGroupResult(
    { ...response, ranking: response.ranking.map((x) => ({ ...x, isSelf: false })) },
    GROUP_ID,
  ).ranking.some((x) => x.isSelf),
  false,
  'excluded viewer has no ranked self row',
)
for (const bad of [
  { ...response, status: 'open' },
  { ...response, ranking: response.ranking.map((x, i) => ({ ...x, isSelf: i < 2 })) },
  { ...response, ranking: [...response.ranking].reverse() },
  {
    ...response,
    ranking: response.ranking.map((x, i) =>
      i === 0 ? { ...x, coinBagHitRate: { numerator: 1, denominator: 3 } } : x,
    ),
  },
  {
    ...response,
    ranking: response.ranking.map((x, i) =>
      i === 1 ? { ...x, entryKey: keyAt(0) } : x,
    ),
  },
]) {
  assert.throws(() => parseGroupResult(bad, GROUP_ID))
}

const detailPayload = {
  groupId: GROUP_ID,
  entryKey: keyAt(0),
  nickname: '山田',
  isSelf: true,
  totalCoins: 5,
  threeCoinsComplete: 1,
  coinBagHits: 2,
  totalOpens: 4,
  coinBagHitRate: { numerator: 2, denominator: 4 },
  rounds: Array.from({ length: 20 }, (_, index) => ({
    roundNumber: index + 1,
    endReason:
      index === 0
        ? 'cleared'
        : index === 1
          ? 'cashed_out'
          : index === 2
            ? 'bombed'
            : 'interrupted',
    capturedCoins: index === 0 ? 3 : index === 1 ? 2 : 0,
    openedBagCount: index === 3 ? 0 : 1,
    bagCount: 4,
    bombBagNumber: 4,
    coinBagNumbers: [1, 1, 2] as const,
    opens:
      index === 3
        ? []
        : [
            {
              order: 1,
              bagNumber: index === 2 ? 4 : index === 0 ? 1 : 3,
              kind: index === 2 ? 'bomb' : index === 0 ? 'coins' : 'empty',
              coinCount: index === 0 ? 2 : 0,
            },
          ],
  })),
}
const detail = parseGroupResultDetail(detailPayload, GROUP_ID, keyAt(0))
assert.equal(detail.rounds.length, 20)
assert.equal(detail.rounds[0]?.endReason, 'cleared')
assert.equal(detail.rounds[0]?.bagCount, 4)
assert.equal(detail.rounds[0]?.opens[0]?.bagNumber, 1)
assert.equal(detail.rounds[1]?.endReason, 'cashed_out')
assert.equal(detail.rounds[2]?.endReason, 'bombed')
assert.equal(detail.rounds[2]?.opens[0]?.bagNumber, 4)
assert.equal(detail.rounds[3]?.endReason, 'interrupted')
assert.equal(formatGroupRoundEndReason('cleared', ja), '3COINS COMPLETE')
assert.equal(formatGroupRoundEndReason('cashed_out', ja), 'CASH OUT')
assert.equal(formatGroupRoundEndReason('bombed', ja), 'BOMB')
assert.equal(formatGroupRoundEndReason('interrupted', ja), '離脱')
assert.equal(formatGroupRoundEndReason('interrupted', en), 'WITHDRAWN')
assert.equal(
  formatGroupOpenReveal({ order: 1, bagNumber: 3, kind: 'empty', coinCount: 0 }, ja),
  'EMPTY',
)
assert.equal(
  formatGroupOpenReveal({ order: 1, bagNumber: 4, kind: 'bomb', coinCount: 0 }, ja),
  'BOMB',
)
assert.equal(
  formatGroupOpenReveal({ order: 1, bagNumber: 1, kind: 'coins', coinCount: 2 }, ja),
  'COIN ×2',
)

const participant = {
  version: 1,
  groupId: GROUP_ID,
  participantId: PARTICIPANT_ID,
  displayNickname: '山田',
  token: TOKEN,
  acceptedAt: '2026-01-01T00:00:00.000Z',
}
const key = `3cb:group:v1:participant:${GROUP_ID}`
let call: { url: string; init: RequestInit } | null = null
const client = createGroupPlayClient({
  storage: {
    getItem: (k) => (k === key ? JSON.stringify(participant) : null),
    setItem() {},
    removeItem() {},
  },
  crypto: { randomUUID: () => GROUP_ID },
  fetch: async (url, init) => {
    call = { url: String(url), init: init ?? {} }
    if (String(url).includes(`/result/${keyAt(0)}`)) {
      return new Response(JSON.stringify(detailPayload), { status: 200 })
    }
    return new Response(JSON.stringify(response), { status: 200 })
  },
})
assert.deepEqual(await client.getResult(GROUP_ID), parsed)
assert.ok(call)
assert.equal(call.url, `/api/group/matches/${GROUP_ID}/result`)
assert.deepEqual(await client.getResultDetail(GROUP_ID, keyAt(0)), detail)
assert.equal(call.url, `/api/group/matches/${GROUP_ID}/result/${keyAt(0)}`)
assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`)

const screen = readFileSync(resolve(root, 'src/components/GroupResultScreen.tsx'), 'utf8')
const detailScreen = readFileSync(
  resolve(root, 'src/components/GroupResultDetailScreen.tsx'),
  'utf8',
)
const waiting = readFileSync(resolve(root, 'src/components/GroupCompletionWaiting.tsx'), 'utf8')
const entryShell = readFileSync(resolve(root, 'src/components/GroupEntryShell.tsx'), 'utf8')
const play = readFileSync(resolve(root, 'src/components/GroupPlayScreen.tsx'), 'utf8')
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8')
const detailBoardCss = readFileSync(
  resolve(root, 'src/components/DuelMatchDetailBoard.css'),
  'utf8',
)

assert.doesNotMatch(screen, /\.sort\s*\(/)
for (const fragment of [
  'entry.rank',
  'entry.nickname',
  'entry.entryKey',
  'entry.totalCoins',
  'entry.threeCoinsComplete',
  'formatGroupHitRate',
  'entry.isSelf',
  't.duelReturnToTop',
  't.groupViewDetails',
  'fetchDetail',
  'GroupResultDetailScreen',
  'groupBackToResult',
]) {
  assert.ok(screen.includes(fragment), fragment)
}
assert.match(detailScreen, /detail\.rounds\.map/)
assert.match(detailScreen, /formatGroupRoundEndReason/)
assert.match(detailScreen, /DuelMatchDetailBoard/)
assert.match(detailScreen, /openOrder: opened\.order/)
assert.match(detailScreen, /bagNumber: opened\.bagNumber/)
assert.doesNotMatch(detailScreen, /formatGroupOpenReveal/)
assert.match(detailScreen, /group-result-detail__nickname/)
assert.match(detailScreen, /t\.groupBackToResult/)
assert.match(waiting, /POLL_MS = 5000/)
assert.match(waiting, /progress\?\.status === 'closed'/)
assert.match(waiting, /coordinator\.getResult/)
assert.match(waiting, /visibilitychange/)
assert.match(waiting, /groupResultRetry/)
assert.match(waiting, /duel-button-field/)
assert.match(entryShell, /result\.status === 'closed'/)
assert.match(entryShell, /initialClosed=/)
assert.match(entryShell, /GroupResultScreen/)
assert.match(entryShell, /getResultDetail/)
assert.match(entryShell, /GroupReadyScreen/)
assert.match(entryShell, /startedPlay/)
assert.match(play, /onResult=/)
assert.match(screen, /group-result__header/)
assert.match(screen, /group-result__table/)
assert.match(screen, /title=\{entry\.nickname\}/)
assert.doesNotMatch(screen, /group-result__stats/)
/* Header + rows share one vertical scroller; ranking alone must not scroll. */
const groupResultTableBlock = css.match(/\.group-result__table\s*\{[^}]*\}/)?.[0]
const groupResultRankingBlock = css.match(/\.group-result__ranking\s*\{[^}]*\}/)?.[0]
assert.ok(groupResultTableBlock)
assert.ok(groupResultRankingBlock)
assert.match(groupResultTableBlock!, /overflow-y:\s*auto/)
assert.doesNotMatch(groupResultRankingBlock!, /overflow-y:\s*auto/)
assert.doesNotMatch(groupResultRankingBlock!, /scrollbar-gutter/)
assert.match(css, /--group-result-cols/)
assert.match(css, /\.group-result__cols[\s\S]*grid-template-columns: var\(--group-result-cols\)/)
assert.match(css, /8em/)
assert.match(css, /\.group-result__cols > \*\s*\{[\s\S]*?min-width:\s*0/)
assert.match(css, /\.group-result \.group-result__details\.duel-btn--quiet-top/)
assert.match(css, /\.group-result__nickname[\s\S]*text-overflow: ellipsis/)
assert.match(css, /\.group-result__top\s*\{[\s\S]*?flex:\s*0 0 auto/)
assert.match(css, /\.group-result\s*\{[\s\S]*?height:\s*calc\(100dvh - 5\.5rem\)/)
assert.match(css, /\.group-result__cols[\s\S]*padding-inline:\s*var\(--group-result-row-inline-pad\)/)
assert.match(css, /\.group-result-detail__rounds[\s\S]*overflow-y: auto/)
assert.match(
  detailBoardCss,
  /\.duel-match-detail-board \.bag-board[\s\S]*aspect-ratio:\s*7\s*\/\s*6/,
)
assert.match(css, /\.group-result__nickname[\s\S]*font-family: system-ui/)
assert.match(css, /\.group-result-detail__nickname[\s\S]*font-family: system-ui/)
assert.doesNotMatch(css, /\.group-result__nickname[^}]*Georgia/)
assert.doesNotMatch(css, /\.group-result-detail__nickname[^}]*Georgia/)
assert.doesNotMatch(
  `${screen}${detailScreen}${waiting}${entryShell}`,
  /console\.|participantId|token/,
)
assert.equal(ja.groupViewDetails, '詳細')
assert.equal(en.groupViewDetails, 'VIEW DETAILS')
assert.doesNotMatch(ja.groupViewDetails, /詳細をみる/)
assert.equal(ja.groupBackToResult, '結果に戻る')
assert.equal(en.groupBackToResult, 'BACK TO RESULT')
assert.equal(ja.groupRoundInterrupted, '離脱')
console.log('verify:group-result-client OK')
