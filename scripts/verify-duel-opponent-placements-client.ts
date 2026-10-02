/** Browser-only opponent placement client and local adjudication checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelPlayClient,
  DuelPlayClientError,
} from '../src/duel/duelPlayClient'
import {
  DuelOpponentPlacementsValidationError,
  judgeDuelOpponentBag,
  parseDuelOpponentPlacementSet,
} from '../src/duel/duelOpponentPlacements'
import {
  participantStorageKey,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH_ID = '22222222-2222-4222-8222-222222222222'
const TOKEN = `3cb_pa1_${'a'.repeat(42)}A`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function participantStorage() {
  const storage = new MemoryStorage()
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role: 'A', token: TOKEN }),
  )
  return storage
}

const placementsResponse = {
  matchId: MATCH_ID,
  role: 'A',
  totalRounds: 3,
  formationVersion: 1,
  ruleVersion: 1,
  placements: [
    { roundNumber: 1, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [1, 2, 3] },
    { roundNumber: 2, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [1, 2, 2] },
    { roundNumber: 3, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [3, 3, 3] },
  ],
}

const parsed = parseDuelOpponentPlacementSet(placementsResponse, MATCH_ID)
assert.deepEqual(parsed, placementsResponse)
assert.deepEqual(parsed.placements[1]?.coinBagNumbers, [1, 2, 2])

function expectInvalid(value: unknown, expectedMatchId = MATCH_ID) {
  assert.throws(
    () => parseDuelOpponentPlacementSet(value, expectedMatchId),
    DuelOpponentPlacementsValidationError,
  )
}

for (const malformed of [
  { ...placementsResponse, placements: placementsResponse.placements.slice(0, 2) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 1 ? { ...p, roundNumber: 3 } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, bagCount: 2 } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, bombBagNumber: 6 } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, coinBagNumbers: [1, 2, 6] } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, coinBagNumbers: [1, 2] } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, coinBagNumbers: [2, 1, 3] } : p) },
  { ...placementsResponse, placements: placementsResponse.placements.map((p, i) => i === 0 ? { ...p, coinBagNumbers: [1, 2, 5] } : p) },
  { ...placementsResponse, role: 'C' },
  { ...placementsResponse, formationVersion: 0 },
  { ...placementsResponse, ruleVersion: 0 },
  { ...placementsResponse, matchId: OTHER_MATCH_ID },
  { ...placementsResponse, matchId: 'not-a-uuid' },
]) expectInvalid(malformed)
expectInvalid(placementsResponse, 'not-a-uuid')

const single = parsed.placements[0]!
assert.deepEqual(judgeDuelOpponentBag(single, 4), { outcome: 'empty', coinsFound: 0 })
assert.deepEqual(judgeDuelOpponentBag(single, 5), { outcome: 'bomb', coinsFound: 0 })
assert.deepEqual(judgeDuelOpponentBag(single, 1), { outcome: 'coins', coinsFound: 1 })
assert.deepEqual(judgeDuelOpponentBag(parsed.placements[1]!, 2), { outcome: 'coins', coinsFound: 2 })
assert.deepEqual(judgeDuelOpponentBag(parsed.placements[2]!, 3), { outcome: 'coins', coinsFound: 3 })
assert.throws(() => judgeDuelOpponentBag(single, 0), DuelOpponentPlacementsValidationError)
assert.throws(() => judgeDuelOpponentBag(single, 6), DuelOpponentPlacementsValidationError)

type CapturedCall = { url: string; init?: RequestInit }
const calls: CapturedCall[] = []
const client = createDuelPlayClient({
  storage: participantStorage(),
  crypto: { randomUUID: () => OTHER_MATCH_ID },
  fetch: async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json(placementsResponse)
  },
})
assert.deepEqual(await client.getOpponentPlacements(MATCH_ID), placementsResponse)
assert.equal(calls.length, 1)
assert.equal(calls[0]?.url, `/api/duel/matches/${MATCH_ID}/opponent-placements`)
assert.equal(calls[0]?.init?.method, 'GET')
assert.equal(calls[0]?.init?.body, undefined)
assert.equal(new Headers(calls[0]?.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
assert(!calls[0]?.url.includes(TOKEN))

async function expectClientError(response: Response, kind: DuelPlayClientError['kind']) {
  const failingClient = createDuelPlayClient({
    storage: participantStorage(),
    crypto: { randomUUID: () => OTHER_MATCH_ID },
    fetch: async () => response,
  })
  try {
    await failingClient.getOpponentPlacements(MATCH_ID)
  } catch (error) {
    assert(error instanceof DuelPlayClientError)
    assert.equal(error.kind, kind)
    assert(!error.message.includes(TOKEN))
    assert(!error.message.includes(MATCH_ID))
    return
  }
  assert.fail(`Expected ${kind}`)
}

await expectClientError(Response.json({ error: TOKEN }, { status: 403 }), 'unavailable')
await expectClientError(Response.json({ error: TOKEN }, { status: 500 }), 'server')
await expectClientError(Response.json({ ...placementsResponse, role: 'C' }), 'malformed-response')

const clientSource = await readFile('src/duel/duelPlayClient.ts', 'utf8')
const placementsSource = await readFile('src/duel/duelOpponentPlacements.ts', 'utf8')
const playScreenSource = await readFile('src/components/DuelPlayScreen.tsx', 'utf8')
const serverOpenSource = await readFile('server/db/openDuelBag.ts', 'utf8')
for (const source of [clientSource, placementsSource]) {
  for (const forbidden of [
    '../server/', 'server/db', 'node:crypto', 'DATABASE_URL', 'DUEL_TOKEN_HMAC_KEY',
    'localStorage', 'setItem(', 'console.',
  ]) assert(!source.includes(forbidden))
}
assert(!playScreenSource.includes('getOpponentPlacements'))
assert(!playScreenSource.includes('judgeDuelOpponentBag'))
assert(serverOpenSource.includes('target.bomb_bag_number'))
assert(serverOpenSource.includes('unnest(target.coin_bag_numbers)'))
assert(serverOpenSource.includes("then 'bomb'"))
assert(serverOpenSource.includes("then 'coins'"))
assert(serverOpenSource.includes("else 'empty'"))

console.log('verify:duel-opponent-placements-client OK')
