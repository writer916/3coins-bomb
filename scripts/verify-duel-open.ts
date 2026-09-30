/** DUEL server-only one-bag OPEN checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createOpenBagHandler } from '../api/duel/matches/[matchId]/rounds/[roundNumber]/open.ts'
import {
  OpenBagError,
  openBag,
  validateOpenBagRequest,
  type OpenBagRequest,
} from '../server/duel/openBag.ts'
import type {
  OpenDuelBagInput,
  OpenDuelBagResult,
  OpenDuelBagView,
} from '../server/db/openDuelBag.ts'
import {
  DUEL_TOKEN_HMAC_KEY_ENV,
  deriveMatchCreationTokens,
  deriveParticipantBToken,
  hashDuelToken,
} from '../server/auth/duelTokens.ts'

const root = resolve(import.meta.dirname, '..')
const matchId = '550e8400-e29b-41d4-a716-446655440000'
const otherMatchId = '650e8400-e29b-41d4-a716-446655440000'
const requestId = '750e8400-e29b-41d4-a716-446655440000'
const secondRequestId = '850e8400-e29b-41d4-a716-446655440000'
const fixtureEnvironment = {
  [DUEL_TOKEN_HMAC_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64url'),
}
const creationTokens = deriveMatchCreationTokens(
  {
    createRequestId: matchId,
    createRecoverySecret: Buffer.alloc(32, 0x41).toString('base64url'),
  },
  fixtureEnvironment,
)
const participantAToken = creationTokens.participantToken
const participantBToken = deriveParticipantBToken(
  {
    matchId,
    invitationToken: creationTokens.invitationToken,
    claimRecoverySecret: Buffer.alloc(32, 0x42).toString('base64url'),
  },
  fixtureEnvironment,
)

function body(bagNumber = 3, expectedOpenOrder = 1): object {
  return { bagNumber, expectedOpenOrder }
}

const validRequest = validateOpenBagRequest(
  matchId,
  1,
  `Bearer ${participantAToken}`,
  requestId,
  body(),
)
assert.deepEqual(validRequest, {
  matchId,
  participantToken: participantAToken,
  requestId,
  roundNumber: 1,
  bagNumber: 3,
  expectedOpenOrder: 1,
})
assert(!Object.hasOwn(validRequest, 'role'))

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof OpenBagError)
    assert.equal(error.code, code)
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}

for (const args of [
  ['invalid', 1, `Bearer ${participantAToken}`, requestId, body()],
  [matchId, 0, `Bearer ${participantAToken}`, requestId, body()],
  [matchId, 21, `Bearer ${participantAToken}`, requestId, body()],
  [matchId, 1, 'Bearer invalid', requestId, body()],
  [matchId, 1, `Bearer ${participantAToken}`, 'not-a-uuid', body()],
] as const) {
  expectCode(
    () => validateOpenBagRequest(args[0], args[1], args[2], args[3], args[4]),
    args[0] === matchId && args[1] >= 1 && args[1] <= 20 && args[3] === requestId
      ? 'MATCH_UNAVAILABLE'
      : args[0] === 'invalid'
        ? 'MATCH_UNAVAILABLE'
        : 'INVALID_REQUEST',
  )
}

for (const invalidBody of [
  {},
  { bagNumber: 1 },
  { bagNumber: 0, expectedOpenOrder: 1 },
  { bagNumber: 9, expectedOpenOrder: 1 },
  { bagNumber: 1.5, expectedOpenOrder: 1 },
  { bagNumber: 1, expectedOpenOrder: 0 },
  { bagNumber: 1, expectedOpenOrder: 9 },
  { bagNumber: 1, expectedOpenOrder: 1, role: 'A' },
]) {
  expectCode(
    () =>
      validateOpenBagRequest(
        matchId,
        1,
        `Bearer ${participantAToken}`,
        requestId,
        invalidBody,
      ),
    'INVALID_REQUEST',
  )
}

const emptyView: OpenDuelBagView = {
  matchId,
  roundNumber: 1,
  bagNumber: 3,
  openOrder: 1,
  outcome: 'empty',
  coinsFound: 0,
  provisionalCoins: 0,
  openedBagCount: 1,
  roundEnded: false,
  endReason: null,
  capturedCoins: null,
  participantCompleted: false,
}

let persistedInput: OpenDuelBagInput | undefined
const success = await openBag(validRequest, {
  persist: async (input) => {
    persistedInput = input
    return { status: 'opened', view: emptyView }
  },
})
assert.deepEqual(success, emptyView)
assert.equal(persistedInput?.participantTokenHash, hashDuelToken(participantAToken))
assert(!Object.hasOwn(persistedInput ?? {}, 'participantToken'))
assert(!Object.hasOwn(persistedInput ?? {}, 'role'))

for (const status of ['unavailable', 'conflict'] as const) {
  await assert.rejects(
    openBag(validRequest, { persist: async () => ({ status }) }),
    (error: unknown) =>
      error instanceof OpenBagError &&
      error.code === (status === 'unavailable' ? 'MATCH_UNAVAILABLE' : 'OPEN_CONFLICT'),
  )
}

interface Placement {
  readonly bomb: number
  readonly coins: readonly [number, number, number]
  readonly bagCount: number
}
interface MemoryOpen {
  readonly input: OpenDuelBagInput
  readonly view: OpenDuelBagView
}

function memoryGame(options: {
  explorerRole?: 'A' | 'B'
  locked?: boolean
  expired?: boolean
  placement?: Placement
  totalRounds?: number
} = {}) {
  const explorerRole = options.explorerRole ?? 'A'
  const tokenHash = hashDuelToken(
    explorerRole === 'A' ? participantAToken : participantBToken,
  )
  const placement = options.placement ?? { bomb: 4, coins: [1, 1, 2], bagCount: 4 }
  const totalRounds = options.totalRounds ?? 1
  const opens: MemoryOpen[] = []
  let result: OpenDuelBagView | null = null
  const persist = async (input: OpenDuelBagInput): Promise<OpenDuelBagResult> => {
    if (
      options.expired ||
      options.locked === false ||
      input.matchId !== matchId ||
      input.participantTokenHash !== tokenHash
    ) {
      return { status: 'unavailable' }
    }
    const sameRequest = opens.find((open) => open.input.requestId === input.requestId)
    if (sameRequest) {
      return sameRequest.input.roundNumber === input.roundNumber &&
        sameRequest.input.bagNumber === input.bagNumber &&
        sameRequest.input.expectedOpenOrder === input.expectedOpenOrder
        ? { status: 'retry', view: sameRequest.view }
        : { status: 'conflict' }
    }
    if (result || input.roundNumber !== 1) return { status: 'conflict' }
    if (
      input.bagNumber > placement.bagCount ||
      input.expectedOpenOrder !== opens.length + 1 ||
      opens.some((open) => open.input.bagNumber === input.bagNumber)
    ) {
      return { status: 'conflict' }
    }
    const coinsFound = placement.coins.filter((bag) => bag === input.bagNumber).length as
      | 0
      | 1
      | 2
      | 3
    const bomb = input.bagNumber === placement.bomb
    const priorCoins = opens.reduce((sum, open) => sum + open.view.coinsFound, 0)
    const foundCoins = priorCoins + coinsFound
    const cleared = foundCoins === 3
    const view: OpenDuelBagView = {
      matchId,
      roundNumber: 1,
      bagNumber: input.bagNumber,
      openOrder: input.expectedOpenOrder,
      outcome: bomb ? 'bomb' : coinsFound > 0 ? 'coins' : 'empty',
      coinsFound,
      provisionalCoins: bomb ? 0 : (foundCoins as 0 | 1 | 2 | 3),
      openedBagCount: input.expectedOpenOrder,
      roundEnded: bomb || cleared,
      endReason: bomb ? 'bombed' : cleared ? 'cleared' : null,
      capturedCoins: bomb ? 0 : cleared ? 3 : null,
      participantCompleted: (bomb || cleared) && totalRounds === 1,
    }
    opens.push({ input: { ...input }, view })
    if (view.roundEnded) result = view
    return { status: 'opened', view }
  }
  return { persist, opens, get result() { return result } }
}

async function play(
  game: ReturnType<typeof memoryGame>,
  bagNumber: number,
  expectedOpenOrder: number,
  id: string,
  token = participantAToken,
): Promise<OpenBagResponse> {
  const request: OpenBagRequest = {
    matchId,
    participantToken: token,
    requestId: id,
    roundNumber: 1,
    bagNumber,
    expectedOpenOrder,
  }
  return openBag(request, { persist: game.persist })
}

type OpenBagResponse = Awaited<ReturnType<typeof openBag>>

const outcomes = memoryGame()
const twoCoins = await play(outcomes, 1, 1, requestId)
assert.deepEqual(
  { outcome: twoCoins.outcome, coinsFound: twoCoins.coinsFound, provisional: twoCoins.provisionalCoins },
  { outcome: 'coins', coinsFound: 2, provisional: 2 },
)
const empty = await play(outcomes, 3, 2, secondRequestId)
assert.equal(empty.outcome, 'empty')
assert.equal(empty.provisionalCoins, 2)
assert.equal(empty.roundEnded, false)

const oneCoinGame = memoryGame({ placement: { bomb: 4, coins: [1, 2, 3], bagCount: 4 } })
assert.equal((await play(oneCoinGame, 1, 1, requestId)).coinsFound, 1)

const threeCoinGame = memoryGame({ placement: { bomb: 4, coins: [1, 1, 1], bagCount: 4 } })
const clear = await play(threeCoinGame, 1, 1, requestId)
assert.equal(clear.coinsFound, 3)
assert.equal(clear.endReason, 'cleared')
assert.equal(clear.capturedCoins, 3)
assert.equal(threeCoinGame.result?.roundEnded, true)

const bombGame = memoryGame()
await play(bombGame, 1, 1, requestId)
const bomb = await play(bombGame, 4, 2, secondRequestId)
assert.equal(bomb.outcome, 'bomb')
assert.equal(bomb.provisionalCoins, 0)
assert.equal(bomb.capturedCoins, 0)
assert.equal(bomb.endReason, 'bombed')

const retryGame = memoryGame()
const first = await play(retryGame, 3, 1, requestId)
const retry = await play(retryGame, 3, 1, requestId)
assert.deepEqual(retry, first)
assert.equal(retryGame.opens.length, 1)
await assert.rejects(play(retryGame, 2, 1, requestId), OpenBagError)
await assert.rejects(play(retryGame, 3, 2, secondRequestId), OpenBagError)
await assert.rejects(play(retryGame, 5, 2, secondRequestId), OpenBagError)

const concurrent = memoryGame()
const concurrentResults = await Promise.allSettled([
  play(concurrent, 2, 1, requestId),
  play(concurrent, 3, 1, secondRequestId),
])
assert.equal(concurrentResults.filter((item) => item.status === 'fulfilled').length, 1)
assert.equal(concurrent.opens.length, 1)

const independentA = memoryGame({ explorerRole: 'A' })
const independentB = memoryGame({ explorerRole: 'B' })
const [aOpen, bOpen] = await Promise.all([
  play(independentA, 3, 1, requestId, participantAToken),
  play(independentB, 3, 1, secondRequestId, participantBToken),
])
assert.equal(aOpen.openOrder, 1)
assert.equal(bOpen.openOrder, 1)

for (const game of [memoryGame({ locked: false }), memoryGame({ expired: true })]) {
  await assert.rejects(play(game, 3, 1, requestId), OpenBagError)
  assert.equal(game.opens.length, 0)
}
await assert.rejects(
  openBag({ ...validRequest, matchId: otherMatchId }, { persist: memoryGame().persist }),
  OpenBagError,
)

const dbSource = readFileSync(resolve(root, 'server/db/openDuelBag.ts'), 'utf8').toLowerCase()
assert.equal((dbSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(dbSource.includes('with candidate as materialized'))
assert(dbSource.includes('for update of self'))
assert(dbSource.includes('insert into duel_round_opens'))
assert(dbSource.includes('insert into duel_round_results'))
assert(dbSource.includes('not exists (select 1 from response)'))
assert(dbSource.includes('match.expires_at > statement_timestamp()'))
assert(dbSource.includes('opponent.placement_locked_at is not null'))
assert(dbSource.includes('self.placement_locked_at is not null'))
assert(dbSource.indexOf('exact_retry as materialized') < dbSource.indexOf('target as materialized'))
assert(!dbSource.includes('.transaction('))
assert(!dbSource.includes('delete from'))

const handler = createOpenBagHandler(async (_request, dependencies) => {
  dependencies?.onDatabaseTiming?.({
    startedAtMs: performance.now(),
    durationMs: 0.25,
  })
  return emptyView
})
function apiRequest(options: {
  requestBody?: unknown
  method?: string
  authorization?: string
  idempotencyKey?: string
  id?: string
  round?: string
} = {}): Request {
  const method = options.method ?? 'POST'
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/rounds/${options.round ?? '1'}/open`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: options.authorization ?? `Bearer ${participantAToken}`,
        'Idempotency-Key': options.idempotencyKey ?? requestId,
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.requestBody ?? body()),
    },
  )
}

const apiSuccess = await handler(apiRequest())
assert.equal(apiSuccess.status, 200)
assert.equal(apiSuccess.headers.get('cache-control'), 'no-store')
const timingHeader = apiSuccess.headers.get('server-timing') ?? ''
assert.match(timingHeader, /^app;dur=\d+\.\d{2}, pre_db;dur=\d+\.\d{2}, db;dur=0\.25, post_db;dur=\d+\.\d{2}$/)
for (const forbidden of [participantAToken, participantBToken, matchId, 'sql', 'placement']) {
  assert(!timingHeader.toLowerCase().includes(forbidden.toLowerCase()))
}
const apiJson = await apiSuccess.json()
assert.deepEqual(apiJson, emptyView)
const serialized = JSON.stringify(apiJson)
for (const forbidden of [
  participantAToken,
  participantBToken,
  creationTokens.invitationToken,
  'bombBagNumber',
  'coinBagNumbers',
  'participantTokenHash',
  'placementRole',
]) {
  assert(!serialized.includes(forbidden))
}

const conflictHandler = createOpenBagHandler(async () => {
  throw new OpenBagError('OPEN_CONFLICT')
})
const conflictResponse = await conflictHandler(apiRequest())
assert.equal(conflictResponse.status, 409)
assert.deepEqual(await conflictResponse.json(), { error: { code: 'open_conflict' } })

const unavailableHandler = createOpenBagHandler(async () => {
  throw new OpenBagError('MATCH_UNAVAILABLE')
})
const unavailableResponse = await unavailableHandler(apiRequest())
assert.equal(unavailableResponse.status, 404)
assert.deepEqual(await unavailableResponse.json(), { error: { code: 'match_unavailable' } })

const invalidResponse = await handler(apiRequest({ idempotencyKey: 'invalid' }))
assert.equal(invalidResponse.status, 400)
const methodResponse = await handler(apiRequest({ method: 'GET' }))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'POST')

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
assert.equal(packageJson.scripts['verify:duel-open'], 'tsx scripts/verify-duel-open.ts')

const schemaDiff = readFileSync(resolve(root, 'server/db/schema.ts'), 'utf8')
const migrationDiff = readFileSync(resolve(root, 'drizzle/0001_wild_solo.sql'), 'utf8')
assert(schemaDiff.includes('duel_round_opens'))
assert(migrationDiff.includes('duel_round_results'))

console.log('verify:duel-open OK')
