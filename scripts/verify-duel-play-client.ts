/** Browser-only DUEL play API client checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  bagIdToBagNumber,
  bagNumberToBagId,
  createDuelPlayClient,
  DuelPlayClientError,
} from '../src/duel/duelPlayClient'
import {
  participantStorageKey,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = `3cb_pa1_${'a'.repeat(42)}A`
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

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

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

const activeRound = {
  roundNumber: 2,
  bagCount: 5,
  openedBags: [
    { bagNumber: 2, openOrder: 1, outcome: 'empty', coinsFound: 0 },
    { bagNumber: 4, openOrder: 2, outcome: 'coins', coinsFound: 2 },
  ],
  provisionalCoins: 2,
  nextOpenOrder: 3,
}
const terminalRound = {
  roundNumber: 1,
  bagCount: 4,
  openedBags: [{ bagNumber: 4, openOrder: 1, outcome: 'bomb', coinsFound: 0 }],
  endReason: 'bombed',
  capturedCoins: 0,
  openedBagCount: 1,
}
const playResponse = {
  matchId: MATCH_ID,
  role: 'A',
  totalRounds: 3,
  participantCompleted: false,
  nextPlayableRoundNumber: 2,
  selfProgress: { completedRounds: 1, totalCapturedCoins: 0 },
  activeRound,
  latestTerminalRound: terminalRound,
}
const openResponse = {
  matchId: MATCH_ID,
  roundNumber: 2,
  bagNumber: 1,
  openOrder: 3,
  outcome: 'coins',
  coinsFound: 1,
  provisionalCoins: 3,
  openedBagCount: 3,
  roundEnded: true,
  endReason: 'cleared',
  capturedCoins: 3,
  participantCompleted: false,
}
const cashResponse = {
  matchId: MATCH_ID,
  roundNumber: 2,
  endReason: 'cashed_out',
  capturedCoins: 2,
  openedBagCount: 2,
  participantCompleted: false,
}
const revealResponse = {
  matchId: MATCH_ID,
  roundNumber: 1,
  bagCount: 5,
  bags: [
    { bagNumber: 1, contents: { kind: 'coins', coinCount: 1 } },
    { bagNumber: 2, contents: { kind: 'coins', coinCount: 2 } },
    { bagNumber: 3, contents: { kind: 'empty' } },
    { bagNumber: 4, contents: { kind: 'empty' } },
    { bagNumber: 5, contents: { kind: 'bomb' } },
  ],
}

type CapturedCall = { url: string; init?: RequestInit }
function clientFor(
  responder: (url: string, init?: RequestInit) => Promise<Response>,
  calls: CapturedCall[] = [],
) {
  return createDuelPlayClient({
    storage: storageWithParticipant(),
    crypto: { randomUUID: () => REQUEST_ID },
    fetch: async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      return responder(url, init)
    },
  })
}

async function expectKind(
  action: () => Promise<unknown>,
  kind: DuelPlayClientError['kind'],
) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof DuelPlayClientError)
    assert.equal(error.kind, kind)
    assert(!error.message.includes(TOKEN))
    assert(!error.message.includes(MATCH_ID))
    return
  }
  assert.fail(`Expected ${kind}`)
}

const playCalls: CapturedCall[] = []
const playClient = clientFor(async () => json(playResponse), playCalls)
assert.deepEqual(await playClient.getPlayState(MATCH_ID), playResponse)
assert.equal(playCalls[0]?.url, `/api/duel/matches/${MATCH_ID}/play`)
assert.equal(playCalls[0]?.init?.method, 'GET')
assert.equal(new Headers(playCalls[0]?.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
assert(!playCalls[0]?.url.includes(TOKEN))

for (const malformed of [
  { ...playResponse, matchId: 'bad' },
  { ...playResponse, role: 'C' },
  { ...playResponse, activeRound: { ...activeRound, nextOpenOrder: 4 } },
  { ...playResponse, activeRound: { ...activeRound, openedBags: [...activeRound.openedBags].reverse() } },
  { ...playResponse, latestTerminalRound: { ...terminalRound, capturedCoins: 1 } },
  { ...playResponse, participantCompleted: true },
  { ...playResponse, selfProgress: { completedRounds: 2, totalCapturedCoins: 0 } },
  { ...playResponse, selfProgress: { completedRounds: 1, totalCapturedCoins: 4 } },
]) {
  await expectKind(() => clientFor(async () => json(malformed)).getPlayState(MATCH_ID), 'malformed-response')
}

const openCalls: CapturedCall[] = []
const openClient = clientFor(async () => json(openResponse), openCalls)
const openCommand = openClient.createOpenCommand({
  matchId: MATCH_ID,
  roundNumber: 2,
  bagNumber: 1,
  expectedOpenOrder: 3,
})
assert.equal(openCommand.requestId, REQUEST_ID)
assert.deepEqual(await openClient.openBag(openCommand), openResponse)
assert.deepEqual(await openClient.openBag(openCommand), openResponse)
assert.equal(openCalls.length, 2)
for (const call of openCalls) {
  assert.equal(call.url, `/api/duel/matches/${MATCH_ID}/rounds/2/open`)
  assert(!call.url.includes(TOKEN))
  assert.equal(new Headers(call.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
  assert.equal(new Headers(call.init?.headers).get('Idempotency-Key'), REQUEST_ID)
  const body = JSON.parse(String(call.init?.body))
  assert.deepEqual(body, { bagNumber: 1, expectedOpenOrder: 3 })
  assert(!Object.hasOwn(body, 'role'))
  assert(!Object.hasOwn(body, 'placement'))
}

for (const malformed of [
  { ...openResponse, matchId: 'bad' },
  { ...openResponse, bagNumber: 2 },
  { ...openResponse, outcome: 'empty', coinsFound: 1 },
  { ...openResponse, roundEnded: false },
]) {
  await expectKind(
    () => clientFor(async () => json(malformed)).openBag(openCommand),
    'malformed-response',
  )
}

const cashCalls: CapturedCall[] = []
const cashClient = clientFor(async () => json(cashResponse), cashCalls)
const cashCommand = cashClient.createCashOutCommand({ matchId: MATCH_ID, roundNumber: 2 })
assert.equal(cashCommand.requestId, REQUEST_ID)
assert.deepEqual(await cashClient.cashOut(cashCommand), cashResponse)
assert.deepEqual(await cashClient.cashOut(cashCommand), cashResponse)
for (const call of cashCalls) {
  assert.equal(call.url, `/api/duel/matches/${MATCH_ID}/rounds/2/cash-out`)
  assert.equal(call.init?.method, 'POST')
  assert.equal(call.init?.body, undefined)
  assert.equal(new Headers(call.init?.headers).get('Idempotency-Key'), REQUEST_ID)
  assert.equal(new Headers(call.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
}
for (const malformed of [
  { ...cashResponse, endReason: 'cleared' },
  { ...cashResponse, capturedCoins: 3 },
  { ...cashResponse, openedBagCount: 0 },
]) {
  await expectKind(
    () => clientFor(async () => json(malformed)).cashOut(cashCommand),
    'malformed-response',
  )
}

const revealCalls: CapturedCall[] = []
const revealClient = clientFor(async () => json(revealResponse), revealCalls)
assert.deepEqual(await revealClient.getRoundReveal(MATCH_ID, 1), revealResponse)
assert.equal(revealCalls[0]?.url, `/api/duel/matches/${MATCH_ID}/rounds/1/reveal`)
assert.equal(revealCalls[0]?.init?.method, 'GET')
assert(!revealCalls[0]?.url.includes(TOKEN))
assert.equal(new Headers(revealCalls[0]?.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
assert(revealResponse.bags.some((bag) => bag.contents.kind === 'empty'))
assert(revealResponse.bags.some((bag) => bag.contents.kind === 'bomb'))
assert(revealResponse.bags.some((bag) => bag.contents.kind === 'coins' && bag.contents.coinCount === 1))
assert(revealResponse.bags.some((bag) => bag.contents.kind === 'coins' && bag.contents.coinCount === 2))
const tripleReveal = {
  matchId: MATCH_ID,
  roundNumber: 1,
  bagCount: 3,
  bags: [
    { bagNumber: 1, contents: { kind: 'coins', coinCount: 3 } },
    { bagNumber: 2, contents: { kind: 'empty' } },
    { bagNumber: 3, contents: { kind: 'bomb' } },
  ],
}
assert.deepEqual(
  await clientFor(async () => json(tripleReveal)).getRoundReveal(MATCH_ID, 1),
  tripleReveal,
)
for (const malformed of [
  { ...revealResponse, bags: revealResponse.bags.slice(0, 4) },
  { ...revealResponse, bags: [revealResponse.bags[1], revealResponse.bags[0], ...revealResponse.bags.slice(2)] },
  { ...revealResponse, bags: revealResponse.bags.map((bag) => bag.contents.kind === 'bomb' ? { ...bag, contents: { kind: 'empty' } } : bag) },
  { ...revealResponse, bags: revealResponse.bags.map((bag) => bag.bagNumber === 1 ? { ...bag, contents: { kind: 'coins', coinCount: 2 } } : bag) },
]) {
  await expectKind(
    () => clientFor(async () => json(malformed)).getRoundReveal(MATCH_ID, 1),
    'malformed-response',
  )
}

for (const [status, kind] of [
  [409, 'conflict'],
  [404, 'unavailable'],
  [500, 'server'],
] as const) {
  await expectKind(
    () => clientFor(async () => json({ error: { detail: TOKEN } }, status)).openBag(openCommand),
    kind,
  )
}
await expectKind(
  () => clientFor(async () => { throw new Error(TOKEN) }).getPlayState(MATCH_ID),
  'network',
)
await expectKind(
  () => clientFor(async () => new Response('not-json')).getPlayState(MATCH_ID),
  'malformed-response',
)

assert.equal(bagNumberToBagId(1), 'bag-1')
assert.equal(bagNumberToBagId(8), 'bag-8')
assert.equal(bagIdToBagNumber('bag-1'), 1)
assert.equal(bagIdToBagNumber('bag-8'), 8)
assert.throws(() => bagNumberToBagId(0), DuelPlayClientError)

const missingStorage = new MemoryStorage()
await expectKind(
  () => createDuelPlayClient({
    storage: missingStorage,
    crypto: { randomUUID: () => REQUEST_ID },
    fetch: async () => json(playResponse),
  }).getPlayState(MATCH_ID),
  'unavailable',
)

const source = await readFile('src/duel/duelPlayClient.ts', 'utf8')
for (const forbidden of [
  '../server/', 'server/db', 'node:crypto', 'HiddenHand', 'createActiveRound',
  'applyOpenBag', 'tryOpenBag', 'tryCashOut', 'generateSoloSystemHand', 'console.',
  'localStorage.setItem',
]) {
  assert(!source.includes(forbidden))
}
for (const untouched of [
  'src/components/DuelFlow.tsx',
  'src/App.tsx',
  'src/game/round.ts',
  'src/game/open.ts',
]) {
  const content = await readFile(untouched, 'utf8')
  assert(!content.includes('duelPlayClient'))
}

console.log('verify:duel-play-client OK')
