/** DUEL server-only CASH OUT checks. No secret values are output. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCashOutRoundHandler } from '../api/_duel/matches/[matchId]/rounds/[roundNumber]/cash-out.ts'
import {
  CashOutRoundError,
  cashOutRound,
  validateCashOutRoundRequest,
  type CashOutRoundRequest,
} from '../server/duel/cashOutRound.ts'
import type {
  CashOutDuelRoundInput,
  CashOutDuelRoundResult,
  CashOutDuelRoundView,
} from '../server/db/cashOutDuelRound.ts'
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
const tokens = deriveMatchCreationTokens(
  {
    createRequestId: matchId,
    createRecoverySecret: Buffer.alloc(32, 0x41).toString('base64url'),
  },
  fixtureEnvironment,
)
const participantAToken = tokens.participantToken
const participantBToken = deriveParticipantBToken(
  {
    matchId,
    invitationToken: tokens.invitationToken,
    claimRecoverySecret: Buffer.alloc(32, 0x42).toString('base64url'),
  },
  fixtureEnvironment,
)

const requestA = validateCashOutRoundRequest(
  matchId,
  1,
  `Bearer ${participantAToken}`,
  requestId,
)
assert.deepEqual(requestA, {
  matchId,
  participantToken: participantAToken,
  requestId,
  roundNumber: 1,
})
assert(!Object.hasOwn(requestA, 'role'))
assert(!Object.hasOwn(requestA, 'capturedCoins'))
assert(!Object.hasOwn(requestA, 'openedBagCount'))

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof CashOutRoundError)
    assert.equal(error.code, code)
    assert(!error.message.includes(participantAToken))
    assert(!error.message.includes(participantBToken))
    return true
  })
}
expectCode(
  () => validateCashOutRoundRequest('invalid', 1, `Bearer ${participantAToken}`, requestId),
  'MATCH_UNAVAILABLE',
)
expectCode(
  () => validateCashOutRoundRequest(matchId, 0, `Bearer ${participantAToken}`, requestId),
  'INVALID_REQUEST',
)
expectCode(
  () => validateCashOutRoundRequest(matchId, 21, `Bearer ${participantAToken}`, requestId),
  'INVALID_REQUEST',
)
expectCode(
  () => validateCashOutRoundRequest(matchId, 1, 'Bearer invalid', requestId),
  'MATCH_UNAVAILABLE',
)
expectCode(
  () => validateCashOutRoundRequest(matchId, 1, `Bearer ${participantAToken}`, 'invalid'),
  'INVALID_REQUEST',
)

const oneCoinView: CashOutDuelRoundView = {
  matchId,
  roundNumber: 1,
  endReason: 'cashed_out',
  capturedCoins: 1,
  openedBagCount: 2,
  participantCompleted: false,
}
let persistedInput: CashOutDuelRoundInput | undefined
assert.deepEqual(
  await cashOutRound(requestA, {
    persist: async (input) => {
      persistedInput = input
      return { status: 'cashed_out', view: oneCoinView }
    },
  }),
  oneCoinView,
)
assert.equal(persistedInput?.participantTokenHash, hashDuelToken(participantAToken))
assert(!Object.hasOwn(persistedInput ?? {}, 'participantToken'))

for (const status of ['unavailable', 'conflict'] as const) {
  await assert.rejects(
    cashOutRound(requestA, { persist: async () => ({ status }) }),
    (error: unknown) =>
      error instanceof CashOutRoundError &&
      error.code ===
        (status === 'unavailable' ? 'MATCH_UNAVAILABLE' : 'CASH_OUT_CONFLICT'),
  )
}

type Role = 'A' | 'B'
type RoundEnd = 'bombed' | 'cleared' | 'cashed_out'
interface MemoryParticipant {
  tokenHash: string
  provisionalCoins: number
  openedBagCount: number
  currentRound: number
  completedRounds: number
  endReason: RoundEnd | null
  requests: Map<string, { round: number; view: CashOutDuelRoundView }>
}

function memoryMatch(options: { locked?: boolean; expired?: boolean; totalRounds?: number } = {}) {
  const totalRounds = options.totalRounds ?? 2
  const participants: Record<Role, MemoryParticipant> = {
    A: {
      tokenHash: hashDuelToken(participantAToken),
      provisionalCoins: 0,
      openedBagCount: 0,
      currentRound: 1,
      completedRounds: 0,
      endReason: null,
      requests: new Map(),
    },
    B: {
      tokenHash: hashDuelToken(participantBToken),
      provisionalCoins: 0,
      openedBagCount: 0,
      currentRound: 1,
      completedRounds: 0,
      endReason: null,
      requests: new Map(),
    },
  }
  let serial = Promise.resolve()
  const withLock = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    const previous = serial
    let release = () => {}
    serial = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
  const findParticipant = (hash: string) =>
    (Object.entries(participants) as [Role, MemoryParticipant][]).find(
      ([, participant]) => participant.tokenHash === hash,
    )
  const persist = async (input: CashOutDuelRoundInput): Promise<CashOutDuelRoundResult> =>
    withLock(() => {
      if (options.expired || options.locked === false || input.matchId !== matchId) {
        return { status: 'unavailable' }
      }
      const found = findParticipant(input.participantTokenHash)
      if (!found) return { status: 'unavailable' }
      const [role, participant] = found
      const existing = participant.requests.get(input.requestId)
      if (existing) {
        return existing.round === input.roundNumber
          ? { status: 'retry', view: existing.view }
          : { status: 'conflict' }
      }
      if (
        input.roundNumber !== participant.currentRound ||
        participant.endReason !== null ||
        (participant.provisionalCoins !== 1 && participant.provisionalCoins !== 2)
      ) {
        return { status: 'conflict' }
      }
      const view: CashOutDuelRoundView = {
        matchId,
        roundNumber: input.roundNumber,
        endReason: 'cashed_out',
        capturedCoins: participant.provisionalCoins as 1 | 2,
        openedBagCount: participant.openedBagCount,
        participantCompleted: participant.completedRounds + 1 === totalRounds,
      }
      participant.endReason = 'cashed_out'
      participant.completedRounds += 1
      participant.requests.set(input.requestId, { round: input.roundNumber, view })
      void role
      return { status: 'cashed_out', view }
    })
  const open = async (
    role: Role,
    outcome: 'empty' | 'coin' | 'two-coins' | 'bomb' | 'clear',
  ): Promise<'opened' | 'conflict'> =>
    withLock(() => {
      const participant = participants[role]
      if (participant.endReason !== null) return 'conflict'
      participant.openedBagCount += 1
      if (outcome === 'coin') participant.provisionalCoins += 1
      if (outcome === 'two-coins') participant.provisionalCoins += 2
      if (outcome === 'bomb') {
        participant.provisionalCoins = 0
        participant.endReason = 'bombed'
        participant.completedRounds += 1
      }
      if (outcome === 'clear') {
        participant.provisionalCoins = 3
        participant.endReason = 'cleared'
        participant.completedRounds += 1
      }
      return 'opened'
    })
  return { participants, persist, open }
}

function cashRequest(
  token: string,
  id = requestId,
  roundNumber = 1,
): CashOutRoundRequest {
  return { matchId, participantToken: token, requestId: id, roundNumber }
}

const zero = memoryMatch()
await assert.rejects(cashOutRound(cashRequest(participantAToken), { persist: zero.persist }), CashOutRoundError)

const one = memoryMatch()
await one.open('A', 'coin')
const oneResult = await cashOutRound(cashRequest(participantAToken), { persist: one.persist })
assert.equal(oneResult.capturedCoins, 1)
assert.equal(oneResult.openedBagCount, 1)
const oneRetry = await cashOutRound(cashRequest(participantAToken), { persist: one.persist })
assert.deepEqual(oneRetry, oneResult)
await assert.rejects(
  cashOutRound(cashRequest(participantAToken, secondRequestId), { persist: one.persist }),
  CashOutRoundError,
)
await assert.rejects(
  cashOutRound(cashRequest(participantAToken, requestId, 2), { persist: one.persist }),
  CashOutRoundError,
)

const two = memoryMatch()
await two.open('A', 'coin')
await two.open('A', 'coin')
const twoResult = await cashOutRound(cashRequest(participantAToken), { persist: two.persist })
assert.equal(twoResult.capturedCoins, 2)
assert.equal(twoResult.openedBagCount, 2)

const twoInOneBag = memoryMatch()
await twoInOneBag.open('A', 'two-coins')
const twoInOneResult = await cashOutRound(
  cashRequest(participantAToken),
  { persist: twoInOneBag.persist },
)
assert.equal(twoInOneResult.capturedCoins, 2)
assert.equal(twoInOneResult.openedBagCount, 1)

for (const outcome of ['bomb', 'clear'] as const) {
  const ended = memoryMatch()
  await ended.open('A', outcome)
  await assert.rejects(
    cashOutRound(cashRequest(participantAToken), { persist: ended.persist }),
    CashOutRoundError,
  )
}

for (const invalid of [memoryMatch({ expired: true }), memoryMatch({ locked: false })]) {
  await assert.rejects(
    cashOutRound(cashRequest(participantAToken), { persist: invalid.persist }),
    CashOutRoundError,
  )
}
await assert.rejects(
  cashOutRound(
    { ...cashRequest(participantAToken), matchId: otherMatchId },
    { persist: memoryMatch().persist },
  ),
  CashOutRoundError,
)

const independent = memoryMatch()
await independent.open('A', 'coin')
await independent.open('B', 'coin')
const [aCash, bCash] = await Promise.all([
  cashOutRound(cashRequest(participantAToken), { persist: independent.persist }),
  cashOutRound(cashRequest(participantBToken, secondRequestId), { persist: independent.persist }),
])
assert.equal(aCash.capturedCoins, 1)
assert.equal(bCash.capturedCoins, 1)

const cashFirst = memoryMatch()
await cashFirst.open('A', 'coin')
const [cashSettled, laterOpen] = await Promise.all([
  cashOutRound(cashRequest(participantAToken), { persist: cashFirst.persist }),
  cashFirst.open('A', 'empty'),
])
assert.equal(cashSettled.endReason, 'cashed_out')
assert.equal(laterOpen, 'conflict')

const openFirst = memoryMatch()
await openFirst.open('A', 'coin')
await openFirst.open('A', 'coin')
const recalculated = await cashOutRound(cashRequest(participantAToken), {
  persist: openFirst.persist,
})
assert.equal(recalculated.capturedCoins, 2)

const completedMatch = memoryMatch({ totalRounds: 1 })
await completedMatch.open('A', 'coin')
assert.equal(
  (await cashOutRound(cashRequest(participantAToken), { persist: completedMatch.persist }))
    .participantCompleted,
  true,
)

const dbSource = readFileSync(resolve(root, 'server/db/cashOutDuelRound.ts'), 'utf8').toLowerCase()
assert.equal((dbSource.match(/getdatabase\(\)\.execute/g) ?? []).length, 1)
assert(dbSource.includes('with candidate as materialized'))
assert(dbSource.includes('for update of self'))
assert(dbSource.includes('insert into duel_round_results'))
assert(dbSource.includes("'cashed_out'"))
assert(dbSource.includes('open_summary.provisional_coins in (1, 2)'))
assert(dbSource.includes('not open_summary.bomb_opened'))
assert(dbSource.includes('terminal_open_order'))
assert(dbSource.includes('null,'))
assert(dbSource.indexOf('exact_retry as materialized') < dbSource.indexOf('target as materialized'))
assert(!dbSource.includes('delete from'))
assert(!dbSource.includes('.transaction('))

const handler = createCashOutRoundHandler(async () => oneCoinView)
function apiRequest(options: {
  method?: string
  authorization?: string
  idempotencyKey?: string
  id?: string
  round?: string
  body?: BodyInit | null
  contentLength?: string
} = {}): Request {
  const headers = new Headers({
    Authorization: options.authorization ?? `Bearer ${participantAToken}`,
    'Idempotency-Key': options.idempotencyKey ?? requestId,
  })
  if (options.contentLength !== undefined) {
    headers.set('Content-Length', options.contentLength)
  }
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers,
  }
  if (Object.hasOwn(options, 'body')) {
    init.body = options.body
  }
  return new Request(
    `https://example.test/api/duel/matches/${options.id ?? matchId}/rounds/${options.round ?? '1'}/cash-out`,
    init,
  )
}

/* Bodyless / empty-body contracts — including non-null empty representations. */
const omittedBody = apiRequest()
assert.equal(omittedBody.body, null)
assert.equal((await handler(omittedBody)).status, 200)

const explicitNullBody = apiRequest({ body: null })
assert.equal(explicitNullBody.body, null)
assert.equal((await handler(explicitNullBody)).status, 200)

const emptyStringBody = apiRequest({ body: '' })
assert.notEqual(emptyStringBody.body, null)
assert.equal((await handler(emptyStringBody)).status, 200)

const emptyUint8Body = apiRequest({ body: new Uint8Array(0) })
assert.notEqual(emptyUint8Body.body, null)
assert.equal((await handler(emptyUint8Body)).status, 200)

const emptyBlobBody = apiRequest({ body: new Blob([]) })
assert.notEqual(emptyBlobBody.body, null)
assert.equal((await handler(emptyBlobBody)).status, 200)

const contentLengthZero = apiRequest({ body: '', contentLength: '0' })
assert.equal((await handler(contentLengthZero)).status, 200)

const successResponse = await handler(apiRequest())
assert.equal(successResponse.status, 200)
assert.equal(successResponse.headers.get('cache-control'), 'no-store')
const successJson = await successResponse.json()
assert.deepEqual(successJson, oneCoinView)
const serialized = JSON.stringify(successJson)
for (const forbidden of [
  participantAToken,
  participantBToken,
  tokens.invitationToken,
  'bombBagNumber',
  'coinBagNumbers',
  'remainingCoins',
  'participantTokenHash',
  'placementRole',
]) {
  assert(!serialized.includes(forbidden))
}

/* Unexpected non-empty payloads stay rejected (including {}). */
assert.equal((await handler(apiRequest({ body: '{}' }))).status, 400)
assert.equal((await handler(apiRequest({ body: '{"foo":"bar"}' }))).status, 400)
assert.equal((await handler(apiRequest({ body: 'x' }))).status, 400)
assert.equal((await handler(apiRequest({ contentLength: '2' }))).status, 400)
assert.equal((await handler(apiRequest({ idempotencyKey: 'invalid' }))).status, 400)
const methodResponse = await handler(apiRequest({ method: 'GET' }))
assert.equal(methodResponse.status, 405)
assert.equal(methodResponse.headers.get('allow'), 'POST')

const conflictHandler = createCashOutRoundHandler(async () => {
  throw new CashOutRoundError('CASH_OUT_CONFLICT')
})
const conflict = await conflictHandler(apiRequest())
assert.equal(conflict.status, 409)
assert.deepEqual(await conflict.json(), { error: { code: 'cash_out_conflict' } })

const internalHandler = createCashOutRoundHandler(async () => {
  throw new Error('database detail')
})
const internal = await internalHandler(apiRequest())
assert.equal(internal.status, 500)
const internalJson = await internal.json()
assert.deepEqual(internalJson, { error: { code: 'internal_error' } })
assert(!JSON.stringify(internalJson).includes('database detail'))

/* Client bodyless POST → real handler must not 400 on empty runtime bodies. */
const { createDuelPlayClient } = await import('../src/duel/duelPlayClient.ts')
const { participantStorageKey } = await import('../src/duel/duelPersistence.ts')
class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
function storageFor(role: 'A' | 'B', token: string) {
  const storage = new MemoryStorage()
  storage.setItem(
    participantStorageKey(matchId),
    JSON.stringify({ version: 1, matchId, role, token }),
  )
  return storage
}
let bridgeCalls = 0
const bridgeHandler = createCashOutRoundHandler(async (input) => {
  bridgeCalls += 1
  assert.equal(input.roundNumber, 1)
  return {
    ...oneCoinView,
    capturedCoins: 1,
    participantCompleted: false,
  }
})
const bridgedClient = createDuelPlayClient({
  storage: storageFor('A', participantAToken),
  crypto: { randomUUID: () => requestId },
  fetch: async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const absolute = new URL(url, 'https://example.test').href
    /* Rebuild like a runtime adapter: preserve method/headers/body from client init. */
    const request = new Request(absolute, init)
    return bridgeHandler(request)
  },
})
const bridgedCommand = bridgedClient.createCashOutCommand({ matchId, roundNumber: 1 })
assert.equal(bridgedCommand.requestId, requestId)
const bridgedResult = await bridgedClient.cashOut(bridgedCommand)
assert.equal(bridgedResult.endReason, 'cashed_out')
assert.equal(bridgedResult.capturedCoins, 1)
assert.equal(bridgeCalls, 1)

/* Same bridge with empty-string body representation must still succeed if replayed. */
assert.equal(
  (await bridgeHandler(apiRequest({ body: '', idempotencyKey: secondRequestId }))).status,
  200,
)

/* Handler source must not use the old strict body!==null reject. */
const handlerSource = readFileSync(
  resolve(root, 'api/_duel/matches/[matchId]/rounds/[roundNumber]/cash-out.ts'),
  'utf8',
)
assert.match(handlerSource, /assertCashOutHasNoPayload/)
assert.doesNotMatch(
  handlerSource,
  /if \(request\.body !== null\) return errorResponse\(400/,
)
assert.match(handlerSource, /CASH_OUT_BODY_MAX_BYTES/)

/* SQL coin recount contract remains (1-bag multi-coin via unnest count). */
assert(dbSource.includes('left join lateral unnest(target.coin_bag_numbers) coin_bag'))
assert(dbSource.includes('count(coin_bag)::smallint as provisional_coins'))
assert(dbSource.includes('participant_role = candidate.placement_role'))
assert(dbSource.includes('explorer_role'))

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
assert.equal(packageJson.scripts['verify:duel-cash-out'], 'tsx scripts/verify-duel-cash-out.ts')

console.log('verify:duel-cash-out OK')
