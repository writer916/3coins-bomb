/** Completed-only DUEL match detail: domain mapping, HTTP gate, client parser. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createGetDuelMatchDetailHandler } from '../api/_duel/matches/[matchId]/detail'
import { createGetDuelResultHandler } from '../api/_duel/matches/[matchId]/result'
import { buildDuelMatchDetail } from '../server/duel/duelMatchDetail'
import {
  DuelResultDataError,
  type DuelParticipantResultInput,
  type DuelResultRole,
} from '../server/duel/duelResult'
import {
  GetDuelMatchDetailError,
  getDuelMatchDetail,
  validateGetDuelMatchDetailRequest,
} from '../server/duel/getMatchDetail'
import {
  createDuelPlayClient,
  DuelPlayClientError,
  type DuelMatchDetail,
} from '../src/duel/duelPlayClient'
import {
  participantStorageKey,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN_A = `3cb_pa1_${'a'.repeat(42)}A`
const TOKEN_B = `3cb_pb1_${'b'.repeat(42)}A`

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function storageWith(role: 'A' | 'B', token: string) {
  const storage = new MemoryStorage()
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role, token }),
  )
  return storage
}

const placement = (
  roundNumber: number,
  bagCount: number,
  bombBagNumber: number,
  coinBagNumbers: readonly number[],
) => ({ roundNumber, bagCount, bombBagNumber, coinBagNumbers })

const clearRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
) => ({
  roundNumber,
  placementRole,
  endReason: 'cleared' as const,
  capturedCoins: 3,
  bombHit: false,
  openedBagCount: bags.length,
  opens: bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber })),
})

const cashRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
  coins: 1 | 2,
) => ({
  roundNumber,
  placementRole,
  endReason: 'cashed_out' as const,
  capturedCoins: coins,
  bombHit: false,
  openedBagCount: bags.length,
  opens: bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber })),
})

const bombRound = (
  roundNumber: number,
  placementRole: DuelResultRole,
  bags: readonly number[],
) => ({
  roundNumber,
  placementRole,
  endReason: 'bombed' as const,
  capturedCoins: 0,
  bombHit: true,
  openedBagCount: bags.length,
  opens: bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber })),
})

/** A explores B's boards; B explores A's boards. */
const participants: Readonly<Record<DuelResultRole, DuelParticipantResultInput>> = {
  A: {
    role: 'A',
    totalRounds: 3,
    opponentPlacements: [
      // B locked: stacked coins on bag 1, bomb on 4, bagCount 4
      placement(1, 4, 4, [1, 1, 1]),
      // B locked: 5 bags, bomb 5, coins 1/2/3
      placement(2, 5, 5, [1, 2, 3]),
      // B locked: 8 bags, bomb 8, multi-coin bag 2
      placement(3, 8, 8, [2, 2, 3]),
    ],
    rounds: [
      clearRound(1, 'B', [1]),
      cashRound(2, 'B', [1, 2], 2),
      bombRound(3, 'B', [2, 8]),
    ],
  },
  B: {
    role: 'B',
    totalRounds: 3,
    opponentPlacements: [
      // A locked: 3 bags
      placement(1, 3, 3, [1, 1, 2]),
      // A locked: 6 bags
      placement(2, 6, 6, [1, 2, 4]),
      // A locked: 7 bags
      placement(3, 7, 7, [1, 3, 5]),
    ],
    rounds: [
      clearRound(1, 'A', [1, 2]),
      clearRound(2, 'A', [1, 2, 4]),
      cashRound(3, 'A', [1], 1),
    ],
  },
}

const detailForA = buildDuelMatchDetail({
  matchId: MATCH_ID,
  viewerRole: 'A',
  totalRounds: 3,
  participants,
})
const detailForB = buildDuelMatchDetail({
  matchId: MATCH_ID,
  viewerRole: 'B',
  totalRounds: 3,
  participants,
})

/* ⑥ yourPlay = opponent placement + viewer opens */
assert.deepEqual(detailForA.yourPlay.rounds[0], {
  roundNumber: 1,
  bagCount: 4,
  bombBagNumber: 4,
  coinBagNumbers: [1, 1, 1],
  opens: [{ openOrder: 1, bagNumber: 1 }],
})
assert.deepEqual(detailForA.yourPlay.rounds[2]?.bombBagNumber, 8)
assert.deepEqual(detailForA.yourPlay.rounds[2]?.coinBagNumbers, [2, 2, 3])
assert.deepEqual(detailForA.yourPlay.rounds[2]?.opens, [
  { openOrder: 1, bagNumber: 2 },
  { openOrder: 2, bagNumber: 8 },
])

/* ⑦ opponentPlay = viewer placement + opponent opens */
assert.deepEqual(detailForA.opponentPlay.rounds[0], {
  roundNumber: 1,
  bagCount: 3,
  bombBagNumber: 3,
  coinBagNumbers: [1, 1, 2],
  opens: [
    { openOrder: 1, bagNumber: 1 },
    { openOrder: 2, bagNumber: 2 },
  ],
})

/* A/B viewers see swapped sides */
assert.deepEqual(detailForB.yourPlay, detailForA.opponentPlay)
assert.deepEqual(detailForB.opponentPlay, detailForA.yourPlay)

/* ⑧ round order ⑨ openOrder order ⑩ unopened bags omitted ⑪⑫⑬ bag/coin/bomb */
for (const detail of [detailForA, detailForB]) {
  assert.equal(detail.status, 'completed')
  assert.equal(detail.totalRounds, 3)
  for (const side of [detail.yourPlay, detail.opponentPlay]) {
    assert.equal(side.rounds.length, 3)
    side.rounds.forEach((round, index) => {
      assert.equal(round.roundNumber, index + 1)
      assert.ok(round.bagCount >= 3 && round.bagCount <= 8)
      assert.ok(round.bombBagNumber >= 1 && round.bombBagNumber <= round.bagCount)
      assert.equal(round.coinBagNumbers.length, 3)
      const seen = new Set<number>()
      round.opens.forEach((opened, openIndex) => {
        assert.equal(opened.openOrder, openIndex + 1)
        assert.ok(!seen.has(opened.bagNumber))
        seen.add(opened.bagNumber)
        assert.ok(opened.bagNumber >= 1 && opened.bagNumber <= round.bagCount)
      })
      assert.ok(round.opens.length < round.bagCount || round.opens.length === round.bagCount)
    })
  }
}
assert.equal(detailForA.yourPlay.rounds[1]?.opens.length, 2, 'cash-out leaves bags unopened')
assert.ok(
  !detailForA.yourPlay.rounds[1]?.opens.some((opened) => opened.bagNumber === 5),
  'unopened bomb bag must not appear in opens',
)

assert.throws(
  () =>
    buildDuelMatchDetail({
      matchId: MATCH_ID,
      viewerRole: 'A',
      totalRounds: 3,
      participants: {
        A: {
          ...participants.A,
          rounds: [
            { ...participants.A.rounds[0]!, openedBagCount: 1, opens: [] },
            participants.A.rounds[1]!,
            participants.A.rounds[2]!,
          ],
        },
        B: participants.B,
      },
    }),
  DuelResultDataError,
)

/* Auth validation: matchId alone / bad token → unavailable */
assert.throws(
  () => validateGetDuelMatchDetailRequest(MATCH_ID, null),
  /unavailable/i,
)
assert.throws(
  () => validateGetDuelMatchDetailRequest(MATCH_ID, 'Bearer not-a-token'),
  /unavailable/i,
)
const validated = validateGetDuelMatchDetailRequest(MATCH_ID, `Bearer ${TOKEN_A}`)
assert.equal(validated.matchId, MATCH_ID)
await assert.rejects(
  getDuelMatchDetail(validated, { getDetail: async () => null }),
  /unavailable/i,
)

/* HTTP: completed OK for A and B; waiting/null → 404; no auth → 404; RESULT untouched */
async function detailRequest(token: string | null, method = 'GET') {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  return createGetDuelMatchDetailHandler(async (request) => {
    if (request.participantToken === TOKEN_A) return detailForA
    if (request.participantToken === TOKEN_B) return detailForB
    throw new Error('unexpected token')
  })(
    new Request(`https://example.test/api/duel/matches/${MATCH_ID}/detail`, {
      method,
      headers,
    }),
  )
}

for (const [token, expected] of [
  [TOKEN_A, detailForA],
  [TOKEN_B, detailForB],
] as const) {
  const response = await detailRequest(token)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), expected)
}

const nullHandler = createGetDuelMatchDetailHandler(async () => {
  throw new GetDuelMatchDetailError()
})
const notCompleted = await nullHandler(
  new Request(`https://example.test/api/duel/matches/${MATCH_ID}/detail`, {
    headers: { Authorization: `Bearer ${TOKEN_A}` },
  }),
)
assert.equal(notCompleted.status, 404)
assert.deepEqual(await notCompleted.json(), { error: { code: 'match_unavailable' } })

const noAuth = await createGetDuelMatchDetailHandler(async () => detailForA)(
  new Request(`https://example.test/api/duel/matches/${MATCH_ID}/detail`),
)
assert.equal(noAuth.status, 404)

const methodNotAllowed = await detailRequest(TOKEN_A, 'POST')
assert.equal(methodNotAllowed.status, 405)

/* RESULT summary contract unchanged (no detail fields on /result) */
const resultHandler = createGetDuelResultHandler(async () => ({
  matchId: MATCH_ID,
  status: 'completed',
  viewerRole: 'A',
  totalRounds: 1,
  winner: 'draw',
  participants: {
    A: {
      role: 'A',
      totalCapturedCoins: 3,
      threeCoinsComplete: 1,
      bombsHit: 0,
      coinBagHits: 1,
      totalOpens: 1,
      hitRate: { numerator: 1, denominator: 1 },
      rounds: [{
        roundNumber: 1,
        endReason: 'cleared',
        capturedCoins: 3,
        openedBagCount: 1,
      }],
    },
    B: {
      role: 'B',
      totalCapturedCoins: 3,
      threeCoinsComplete: 1,
      bombsHit: 0,
      coinBagHits: 1,
      totalOpens: 1,
      hitRate: { numerator: 1, denominator: 1 },
      rounds: [{
        roundNumber: 1,
        endReason: 'cleared',
        capturedCoins: 3,
        openedBagCount: 1,
      }],
    },
  },
}))
const resultJson = await (
  await resultHandler(
    new Request(`https://example.test/api/duel/matches/${MATCH_ID}/result`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    }),
  )
).json() as Record<string, unknown>
assert.deepEqual(Object.keys(resultJson).sort(), [
  'matchId',
  'participants',
  'status',
  'totalRounds',
  'viewerRole',
  'winner',
])
assert.equal('yourPlay' in resultJson, false)
assert.equal('opponentPlay' in resultJson, false)

/* Client parser + auth storage contract (same participant token as RESULT) */
function clientFor(
  value: unknown,
  role: 'A' | 'B',
  token: string,
  calls: { url: string; init?: RequestInit }[] = [],
) {
  return createDuelPlayClient({
    storage: storageWith(role, token),
    crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      if (value instanceof Response) return value
      return Response.json(value)
    },
  })
}

const aCalls: { url: string; init?: RequestInit }[] = []
const parsedA = await clientFor(detailForA, 'A', TOKEN_A, aCalls).getMatchDetail(MATCH_ID)
assert.deepEqual(parsedA, detailForA)
assert.equal(aCalls[0]?.url, `/api/duel/matches/${MATCH_ID}/detail`)
assert.equal(aCalls[0]?.init?.method, 'GET')
assert.equal(
  new Headers(aCalls[0]?.init?.headers).get('Authorization'),
  `Bearer ${TOKEN_A}`,
)
assert(!aCalls[0]?.url.includes(TOKEN_A))

const parsedB = await clientFor(detailForB, 'B', TOKEN_B).getMatchDetail(MATCH_ID)
assert.deepEqual(parsedB, detailForB)

/* ⑭ malformed rejection */
async function malformed(value: unknown) {
  await assert.rejects(
    () => clientFor(value, 'A', TOKEN_A).getMatchDetail(MATCH_ID),
    (error: unknown) =>
      error instanceof DuelPlayClientError &&
      error.kind === 'malformed-response' &&
      !error.message.includes(TOKEN_A),
  )
}

const valid: DuelMatchDetail = detailForA
await malformed({ ...valid, status: 'waiting' })
await malformed({ ...valid, viewerRole: 'C' })
await malformed({ ...valid, extra: true })
await malformed({
  ...valid,
  yourPlay: {
    rounds: [{
      ...valid.yourPlay.rounds[0]!,
      opens: [{ openOrder: 2, bagNumber: 1 }],
    }, valid.yourPlay.rounds[1]!, valid.yourPlay.rounds[2]!],
  },
})
await malformed({
  ...valid,
  yourPlay: {
    rounds: [{
      ...valid.yourPlay.rounds[0]!,
      coinBagNumbers: [1, 1, 4],
      bombBagNumber: 4,
    }, valid.yourPlay.rounds[1]!, valid.yourPlay.rounds[2]!],
  },
})
await malformed({
  ...valid,
  yourPlay: {
    rounds: valid.yourPlay.rounds.slice(0, 2),
  },
})

await assert.rejects(
  () =>
    clientFor(
      new Response(JSON.stringify({ error: { code: 'match_unavailable' } }), {
        status: 404,
      }),
      'A',
      TOKEN_A,
    ).getMatchDetail(MATCH_ID),
  (error: unknown) =>
    error instanceof DuelPlayClientError && error.kind === 'unavailable',
)

/* No token in storage → unavailable (capability restore must precede detail) */
await assert.rejects(
  () =>
    createDuelPlayClient({
      storage: new MemoryStorage(),
      crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
      fetch: async () => Response.json(detailForA),
    }).getMatchDetail(MATCH_ID),
  (error: unknown) =>
    error instanceof DuelPlayClientError && error.kind === 'unavailable',
)

/* Source contracts: shared completion SQL; no schema/migration churn; URL fragments untouched */
const [
  resultDb,
  detailDb,
  detailDomain,
  detailApi,
  playClient,
  claimSource,
  capabilitySource,
  schemaSource,
] = await Promise.all([
  readFile(new URL('../server/db/getDuelResult.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/db/getDuelMatchDetail.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/duel/duelMatchDetail.ts', import.meta.url), 'utf8'),
  readFile(new URL('../api/_duel/matches/[matchId]/detail.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/duel/duelPlayClient.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/duel/duelClaim.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/duel/duelParticipantCapability.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/db/schema.ts', import.meta.url), 'utf8'),
])

assert.match(resultDb, /export async function loadDuelResultCompletionForParticipant/)
assert.match(resultDb, /where completion\.both_completed and completion\.progress_integrity_ok/)
assert.match(detailDb, /loadDuelResultCompletionForParticipant/)
assert.match(detailDb, /snapshot\.kind !== 'completed'/)
assert.match(detailDomain, /yourPlay = opponent LOCK placements \+ viewer opens/)
assert.match(detailDomain, /opponentPlay = viewer LOCK placements \+ opponent opens/)
assert.match(detailDomain, /aggregateDuelParticipantResult/)
assert.match(detailApi, /\/detail\\\/\?\$/)
assert.match(playClient, /\/detail`/)
assert.match(playClient, /async getMatchDetail/)
assert.match(playClient, /participantToken\(dependencies\.storage, id\)/)
assert.doesNotMatch(claimSource, /getMatchDetail|\/detail/)
assert.doesNotMatch(capabilitySource, /getMatchDetail|\/detail/)
assert.match(claimSource, /#invite/)
assert.match(capabilitySource, /classifyDuelMatchUrlFragment|#p|participant/)
assert.match(schemaSource, /duel_round_opens/)
assert.match(schemaSource, /duel_round_placements/)

console.log('verify:duel-match-detail OK')
