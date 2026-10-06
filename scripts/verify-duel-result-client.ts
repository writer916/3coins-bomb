/** Browser DUEL final RESULT client, validation and UI boundary checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDuelPlayClient, DuelPlayClientError } from '../src/duel/duelPlayClient'
import { createDuelPlayCoordinator } from '../src/duel/duelPlayCoordinator'
import { participantStorageKey, type StorageAdapter } from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = `3cb_pa1_${'a'.repeat(42)}A`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function storageWithParticipant() {
  const storage = new MemoryStorage()
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role: 'A', token: TOKEN }),
  )
  return storage
}

const round = (roundNumber: number, endReason: 'cleared' | 'bombed' | 'cashed_out' = 'cleared') => ({
  roundNumber,
  endReason,
  capturedCoins: endReason === 'cleared' ? 3 : endReason === 'cashed_out' ? 2 : 0,
  openedBagCount: 2,
})
const summary = (
  role: 'A' | 'B',
  coins: number,
  completes: number,
  bombsHit: number,
  hits: number,
  opens: number,
  rounds: ReturnType<typeof round>[],
) => ({
  role,
  totalCapturedCoins: coins,
  threeCoinsComplete: completes,
  bombsHit,
  coinBagHits: hits,
  totalOpens: opens,
  hitRate: { numerator: hits, denominator: opens },
  rounds,
})
const waiting = {
  matchId: MATCH_ID,
  status: 'waiting',
  selfCompleted: true,
  opponentCompleted: false,
}
const completed = {
  matchId: MATCH_ID,
  status: 'completed',
  viewerRole: 'A',
  totalRounds: 2,
  winner: 'B',
  participants: {
    A: summary('A', 6, 2, 1, 2, 4, [round(1), round(2)]),
    B: summary('B', 3, 1, 0, 2, 3, [round(1), round(2, 'bombed')]),
  },
}

function clientFor(value: unknown, calls: { url: string; init?: RequestInit }[] = []) {
  return createDuelPlayClient({
    storage: storageWithParticipant(),
    crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return Response.json(value)
    },
  })
}

async function malformed(value: unknown) {
  await assert.rejects(
    () => clientFor(value).getFinalResult(MATCH_ID),
    (error: unknown) => error instanceof DuelPlayClientError &&
      error.kind === 'malformed-response' && !error.message.includes(TOKEN),
  )
}

const waitingCalls: { url: string; init?: RequestInit }[] = []
assert.deepEqual(await clientFor(waiting, waitingCalls).getFinalResult(MATCH_ID), waiting)
assert.equal(waitingCalls.length, 1)
assert.equal(waitingCalls[0]?.url, `/api/duel/matches/${MATCH_ID}/result`)
assert.equal(waitingCalls[0]?.init?.method, 'GET')
assert.equal(new Headers(waitingCalls[0]?.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
assert(!waitingCalls[0]?.url.includes(TOKEN))

assert.deepEqual(await clientFor(completed).getFinalResult(MATCH_ID), completed)
for (const invalid of [
  { ...waiting, opponentScore: 3 },
  { ...completed, viewerRole: 'C' },
  { ...completed, winner: 'C' },
  { ...completed, participants: { ...completed.participants, A: { ...completed.participants.A, totalOpens: 0 } } },
  { ...completed, participants: { ...completed.participants, B: { ...completed.participants.B, hitRate: { numerator: 3, denominator: 6 } } } },
  { ...completed, participants: { ...completed.participants, A: { ...completed.participants.A, rounds: [round(1)] } } },
  { ...completed, participants: { ...completed.participants, A: { ...completed.participants.A, threeCoinsComplete: 1 } } },
  { ...completed, participants: { ...completed.participants, A: { ...completed.participants.A, bombsHit: 0 } } },
]) await malformed(invalid)

let coordinatorCalls = 0
const coordinator = createDuelPlayCoordinator({
  createOpenCommand() { throw new Error('unused') },
  createCashOutCommand() { throw new Error('unused') },
  async getPlayState() { throw new Error('unused') },
  async getOpponentPlacements() { throw new Error('unused') },
  async openBag() { throw new Error('unused') },
  async cashOut() { throw new Error('unused') },
  async getRoundReveal() { throw new Error('unused') },
  async getFinalResult(matchId) {
    coordinatorCalls += 1
    assert.equal(matchId, MATCH_ID)
    return completed as Awaited<ReturnType<ReturnType<typeof createDuelPlayClient>['getFinalResult']>>
  },
  async getMatchDetail() { throw new Error('unused') },
})
assert.equal((await coordinator.getFinalResult(MATCH_ID)).status, 'completed')
assert.equal(coordinatorCalls, 1)

const [screen, resultScreen, client, coordinatorSource, strings, en, ja, css] = await Promise.all([
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/duel/duelPlayClient.ts', 'utf8'),
  readFile('src/duel/duelPlayCoordinator.ts', 'utf8'),
  readFile('src/i18n/types.ts', 'utf8'),
  readFile('src/i18n/en.ts', 'utf8'),
  readFile('src/i18n/ja.ts', 'utf8'),
  readFile('src/App.css', 'utf8'),
])
for (const required of [
  'showNextRound', 'showResult', 't.nextRound', 't.duelResult', 'handleResult',
  'DuelResultScreen', 'resultPendingRef', 'getFinalResult',
]) assert.match(screen, new RegExp(required))
assert.match(screen, /showResult = showEndActions && !canAdvance/)
assert.match(screen, /showRevealBtn/)
assert.match(screen, /resultPendingRef\.current/)
assert.match(screen, /3COINS COMPLETE/)
assert.match(screen, /threeCoinsComplete/)
for (const required of [
  't.duelWaitingTitle', 't.duelWaitingBody', 't.duelViewResult',
  "result.winner === 'draw'", 'result.winner === result.viewerRole',
  'summary.totalCapturedCoins', 'summary.threeCoinsComplete', 'summary.bombsHit',
  't.duelThreeCoinsComplete', 't.duelBombsHit', 't.duelTotalCoins',
  'PlayerCard title={t.duelYou}', 'PlayerCard title={t.duelOpponent}',
  'resolveDuelResultPresentation', 'DUEL_RESULT_POLL_INTERVAL_MS',
]) assert.match(resultScreen, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(resultScreen, /duelCoinBagHitRate|hitRate|COIN-BAG HIT RATE/)
assert.doesNotMatch(resultScreen, /coinBagHits\s*[<>]=?|totalCapturedCoins\s*[<>]=?|roundWins/)
assert.doesNotMatch(resultScreen, /(?<!bombs)bombHit/)
// Display order: TOTAL COINS → 3COINS COMPLETE → BOMBS HIT
const totalIdx = resultScreen.indexOf('t.duelTotalCoins')
const completeIdx = resultScreen.indexOf('t.duelThreeCoinsComplete')
const bombsIdx = resultScreen.indexOf('t.duelBombsHit')
assert.ok(totalIdx > 0 && completeIdx > totalIdx && bombsIdx > completeIdx)
assert.match(client, /status === 'waiting'/)
assert.match(client, /status !== 'completed'/)
assert.match(client, /exactKeys\(item, \['matchId', 'status', 'selfCompleted', 'opponentCompleted'\]\)/)
assert.match(client, /threeCoinsComplete/)
assert.match(client, /bombsHit/)
assert.match(coordinatorSource, /getFinalResult/)
assert.match(strings, /duelThreeCoinsComplete/)
assert.match(strings, /duelBombsHit/)
assert.match(strings, /duelCoinBagHitRate/)
assert.match(strings, /duelViewResult/)
assert.match(en, /duelThreeCoinsComplete: '3COINS COMPLETE'/)
assert.match(ja, /duelThreeCoinsComplete: '3COINS COMPLETE'/)
assert.match(en, /duelBombsHit: 'BOMBS HIT'/)
assert.match(ja, /duelBombsHit: 'BOMBS HIT'/)
assert.match(css, /\.duel-final-scores/)
assert.match(css, /\.duel-final-stat/)
assert.match(css, /\.duel-final-stats\s*{/)
assert.match(css, /\.duel-final\s*{[^}]*width:\s*min\(100%,\s*30rem\)/s)
assert.match(css, /\.duel-final-player\s*{[^}]*width:\s*15\.25rem/s)
assert.match(css, /\.duel-final-scores\s*{[^}]*max-content/s)
assert.match(resultScreen, /<span>\{withDuelNums\(label\)\}<\/span>/)
assert.match(css, /--duel-button-field-h:\s*9\.35rem/)
assert.match(resultScreen, /duel-final-stats/)
assert.doesNotMatch(resultScreen, /duelCoinBagHitRate|hitRate|COIN-BAG HIT RATE/)
assert.match(resultScreen, /setInterval/)
for (const source of [screen, client, coordinatorSource]) {
  assert.doesNotMatch(source, /setInterval|console\.|\.\.\/server\/|server\/db/)
}
assert.doesNotMatch(resultScreen, /console\.|\.\.\/server\/|server\/db/)
assert.match(screen, /initialResult=\{finalResult\}/)
assert.doesNotMatch(screen, /onCheck/)

console.log('verify:duel-result-client OK')
