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

const round = (roundNumber: number) => ({
  roundNumber,
  endReason: 'cleared',
  capturedCoins: 3,
  openedBagCount: 2,
})
const summary = (role: 'A' | 'B', hits: number, opens: number) => ({
  role,
  totalCapturedCoins: 6,
  coinBagHits: hits,
  totalOpens: opens,
  hitRate: { numerator: hits, denominator: opens },
  rounds: [round(1), round(2)],
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
  participants: { A: summary('A', 2, 4), B: summary('B', 4, 6) },
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
})
assert.equal((await coordinator.getFinalResult(MATCH_ID)).status, 'completed')
assert.equal(coordinatorCalls, 1)

const [screen, resultScreen, client, coordinatorSource, strings, css] = await Promise.all([
  readFile('src/components/DuelPlayScreen.tsx', 'utf8'),
  readFile('src/components/DuelResultScreen.tsx', 'utf8'),
  readFile('src/duel/duelPlayClient.ts', 'utf8'),
  readFile('src/duel/duelPlayCoordinator.ts', 'utf8'),
  readFile('src/i18n/types.ts', 'utf8'),
  readFile('src/App.css', 'utf8'),
])
for (const required of [
  'showNextRound', 'showResult', 't.nextRound', 't.duelResult', 'handleResult',
  'DuelResultScreen', 'resultPendingRef', 'getFinalResult',
]) assert.match(screen, new RegExp(required))
assert.match(screen, /showResult = showEndActions && !canAdvance/)
assert.match(screen, /showRevealBtn/)
assert.match(screen, /resultPendingRef\.current/)
for (const required of [
  "result.status === 'waiting'", 't.duelWaitingTitle', 't.duelCheckResult',
  "result.winner === 'draw'", 'result.winner === result.viewerRole',
  'self.totalCapturedCoins', 'opponent.totalCapturedCoins',
  'summary.hitRate.numerator', 'summary.hitRate.denominator',
]) assert.match(resultScreen, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(resultScreen, /coinBagHits\s*[<>]=?|totalCapturedCoins\s*[<>]=?|roundWins|bombHit/)
assert.match(client, /status === 'waiting'/)
assert.match(client, /status !== 'completed'/)
assert.match(client, /exactKeys\(item, \['matchId', 'status', 'selfCompleted', 'opponentCompleted'\]\)/)
assert.match(coordinatorSource, /getFinalResult/)
assert.match(strings, /duelCoinBagHitRate/)
assert.match(css, /\.duel-final-scores/)
for (const source of [screen, resultScreen, client, coordinatorSource]) {
  assert.doesNotMatch(source, /setInterval|console\.|\.\.\/server\/|server\/db/)
}

console.log('verify:duel-result-client OK')
