/**
 * DAILY OPEN / cash-out API: validation, handlers, router wiring, optional Neon.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import dailyApi from '../api/daily.ts'
import { createDailyRoundOpenHandler } from '../api/_daily/challenges/[date]/rounds/open.ts'
import { createDailyRoundCashOutHandler } from '../api/_daily/challenges/[date]/rounds/cash-out.ts'
import {
  DailyOpenApiError,
  openDailyChallengeBag,
  toDailyOpenApiResponse,
  validateDailyOpenRequest,
} from '../server/daily/openBag.ts'
import {
  DailyCashOutApiError,
  cashOutDailyChallengeRound,
  toDailyCashOutApiResponse,
  validateDailyCashOutRequest,
} from '../server/daily/cashOutRound.ts'
import type { DailyOpenView } from '../server/db/openDailyBag.ts'
import type { DailyCashOutView } from '../server/db/cashOutDailyRound.ts'
import {
  deriveDailyParticipantCapability,
  hashDailyParticipantCapability,
} from '../server/auth/dailyTokens.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2099-09-01'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const joinRequestId = randomUUID()
const token = deriveDailyParticipantCapability(date, joinRequestId, environment)
const auth = `Bearer ${token}`
const otherToken = deriveDailyParticipantCapability(
  '2099-09-02',
  randomUUID(),
  environment,
)

const openView: DailyOpenView = {
  challengeDate: date,
  participantId: '11111111-1111-4111-8111-111111111111',
  roundNumber: 1,
  bagNumber: 2,
  openOrder: 1,
  remainingSecondsAtTap: 55,
  outcome: 'coins',
  coinsFound: 1,
  provisionalCoins: 1,
  openedBagCount: 1,
  roundEnded: false,
  endReason: null,
  capturedCoins: 0,
  elapsedSeconds: null,
  coinBagHits: null,
  participantCompleted: false,
}

const cashView: DailyCashOutView = {
  challengeDate: date,
  participantId: '11111111-1111-4111-8111-111111111111',
  roundNumber: 1,
  endReason: 'cashed_out',
  capturedCoins: 1,
  openedBagCount: 1,
  elapsedSeconds: 10,
  coinBagHits: 1,
  remainingSecondsAtTap: 50,
  participantCompleted: false,
}

const openDto = toDailyOpenApiResponse(openView)
assert.equal('participantId' in openDto, false)
assert.doesNotMatch(JSON.stringify(openDto), /bomb/i)
assert.doesNotMatch(JSON.stringify(openDto), /coinBagNumbers|bombBagNumber/)
assert.doesNotMatch(JSON.stringify(toDailyCashOutApiResponse(cashView)), /participantId/)

assert.throws(
  () => validateDailyOpenRequest('bad', auth, randomUUID(), { bagNumber: 1, remainingSecondsAtTap: 60 }),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () =>
    validateDailyOpenRequest(date, null, randomUUID(), {
      bagNumber: 1,
      remainingSecondsAtTap: 60,
    }),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'UNAUTHORIZED',
)
assert.throws(
  () =>
    validateDailyOpenRequest(date, auth, null, {
      bagNumber: 1,
      remainingSecondsAtTap: 60,
    }),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () =>
    validateDailyOpenRequest(date, auth, randomUUID(), {
      bagNumber: 1,
      remainingSecondsAtTap: 0,
    }),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () =>
    validateDailyOpenRequest(date, auth, randomUUID(), {
      bagNumber: 1,
      remainingSecondsAtTap: 60,
      outcome: 'bomb',
    }),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () =>
    validateDailyCashOutRequest(date, auth, randomUUID(), {
      remainingSecondsAtTap: 50,
      capturedCoins: 1,
    }),
  (error: unknown) =>
    error instanceof DailyCashOutApiError && error.code === 'INVALID_REQUEST',
)

const openReq = validateDailyOpenRequest(date, auth, randomUUID(), {
  bagNumber: 2,
  remainingSecondsAtTap: 55,
})
assert.equal(openReq.bagNumber, 2)
assert.equal(openReq.authTokenHash, hashDailyParticipantCapability(token))

assert.deepEqual(
  await openDailyChallengeBag(openReq, async () => ({
    status: 'opened',
    view: openView,
  })),
  openDto,
)
assert.deepEqual(
  await openDailyChallengeBag(openReq, async () => ({
    status: 'retry',
    view: openView,
  })),
  openDto,
)
await assert.rejects(
  () =>
    openDailyChallengeBag(openReq, async () => ({ status: 'conflict' })),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'CONFLICT',
)
await assert.rejects(
  () =>
    openDailyChallengeBag(openReq, async () => ({ status: 'unavailable' })),
  (error: unknown) =>
    error instanceof DailyOpenApiError && error.code === 'UNAVAILABLE',
)

const cashReq = validateDailyCashOutRequest(date, auth, randomUUID(), {
  remainingSecondsAtTap: 50,
})
assert.deepEqual(
  await cashOutDailyChallengeRound(cashReq, async () => ({
    status: 'cashed_out',
    view: cashView,
  })),
  toDailyCashOutApiResponse(cashView),
)
await assert.rejects(
  () =>
    cashOutDailyChallengeRound(cashReq, async () => ({ status: 'conflict' })),
  (error: unknown) =>
    error instanceof DailyCashOutApiError && error.code === 'CONFLICT',
)

const openHandler = createDailyRoundOpenHandler(async () => openDto)
const openOk = await openHandler(
  new Request(`https://example.test/api/daily/challenges/${date}/rounds/open`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Idempotency-Key': randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 55 }),
  }),
)
assert.equal(openOk.status, 200)
assert.equal(openOk.headers.get('cache-control'), 'no-store')
assert.deepEqual(await openOk.json(), openDto)

assert.equal(
  (
    await openHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/open`,
        { method: 'GET' },
      ),
    )
  ).status,
  405,
)
assert.equal(
  (
    await openHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/open`,
        {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Idempotency-Key': randomUUID(),
            'Content-Type': 'text/plain',
          },
          body: '{}',
        },
      ),
    )
  ).status,
  400,
)
assert.equal(
  (
    await openHandler(
      new Request(
        `https://example.test/api/daily/challenges/${date}/rounds/open`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': randomUUID(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 55 }),
        },
      ),
    )
  ).status,
  401,
)

const openConflict = createDailyRoundOpenHandler(async () => {
  throw new DailyOpenApiError('CONFLICT')
})
const conflictRes = await openConflict(
  new Request(`https://example.test/api/daily/challenges/${date}/rounds/open`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Idempotency-Key': randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 55 }),
  }),
)
assert.equal(conflictRes.status, 409)
assert.equal(
  ((await conflictRes.json()) as { error: { code: string } }).error.code,
  'open_conflict',
)

const cashHandler = createDailyRoundCashOutHandler(async () =>
  toDailyCashOutApiResponse(cashView),
)
const cashOk = await cashHandler(
  new Request(
    `https://example.test/api/daily/challenges/${date}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 50 }),
    },
  ),
)
assert.equal(cashOk.status, 200)
assert.deepEqual(await cashOk.json(), toDailyCashOutApiResponse(cashView))

const cashConflict = createDailyRoundCashOutHandler(async () => {
  throw new DailyCashOutApiError('CONFLICT')
})
const cashConflictRes = await cashConflict(
  new Request(
    `https://example.test/api/daily/challenges/${date}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 50 }),
    },
  ),
)
assert.equal(cashConflictRes.status, 409)
assert.equal(
  ((await cashConflictRes.json()) as { error: { code: string } }).error.code,
  'cash_out_conflict',
)

// Router wiring: new routes resolve; join route still present.
const routedOpen = await dailyApi.fetch(
  new Request(`https://example.test/api/daily/challenges/${date}/rounds/open`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Idempotency-Key': randomUUID(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 60 }),
  }),
)
assert.notEqual(
  ((await routedOpen.json()) as { error?: { code?: string } }).error?.code,
  'not_found',
)

const routedCash = await dailyApi.fetch(
  new Request(
    `https://example.test/api/daily/challenges/${date}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 50 }),
    },
  ),
)
assert.notEqual(
  ((await routedCash.json()) as { error?: { code?: string } }).error?.code,
  'not_found',
)

const joinRoute = await dailyApi.fetch(
  new Request('https://example.test/api/daily/challenges/current/participants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'X', joinRequestId: randomUUID() }),
  }),
)
assert.notEqual(
  ((await joinRoute.json()) as { error?: { code?: string } }).error?.code,
  'not_found',
)

const dailyRouter = readFileSync(resolve(root, 'api/daily.ts'), 'utf8')
assert.match(dailyRouter, /rounds\/open/)
assert.match(dailyRouter, /rounds\/cash-out/)
assert.match(dailyRouter, /rounds\/start/)

for (const file of [
  'server/daily/openBag.ts',
  'server/daily/cashOutRound.ts',
  'api/_daily/challenges/[date]/rounds/open.ts',
  'api/_daily/challenges/[date]/rounds/cash-out.ts',
]) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert.doesNotMatch(source, /console\./)
  assert.doesNotMatch(source, /bombBagNumber|coinBagNumbers/)
}

function loadNeonDevUrl(): string | null {
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv?.includes('ep-still-night-b339xjc9-pooler')) return fromEnv
  try {
    const raw = readFileSync(resolve(root, '.env.neon.dev.local'), 'utf8').trim()
    const match = /^DATABASE_URL=(.+)$/m.exec(raw)
    const url = match?.[1]?.trim()
    if (url?.includes('ep-still-night-b339xjc9-pooler')) return url
  } catch {
    /* optional */
  }
  return null
}

const neonUrl = loadNeonDevUrl()
if (!neonUrl) {
  console.log('verify:daily-open-cashout-api OK (handlers; Neon skipped)')
  process.exit(0)
}
if (neonUrl.includes('ep-ancient-lake')) {
  throw new Error('Refusing production Neon endpoint.')
}
process.env.DATABASE_URL = neonUrl

const { sql } = await import('drizzle-orm')
const { getDatabase } = await import('../server/db/client.ts')
const { persistOrLoadDailyQuestionSet } = await import(
  '../server/db/dailyQuestionSet.ts'
)
const { provideDailyQuestionRounds } = await import(
  '../server/daily/provideDailyQuestionSet.ts'
)
const { createDailyRoundStartHandler } = await import(
  '../api/_daily/challenges/[date]/rounds/start.ts'
)
const { createDailyRoundOpenHandler: liveOpen } = await import(
  '../api/_daily/challenges/[date]/rounds/open.ts'
)
const { createDailyRoundCashOutHandler: liveCash } = await import(
  '../api/_daily/challenges/[date]/rounds/cash-out.ts'
)

const liveDate = '2099-09-01'
const liveJoin = randomUUID()
const liveToken = deriveDailyParticipantCapability(
  liveDate,
  liveJoin,
  environment,
)
const liveHash = hashDailyParticipantCapability(liveToken)
const liveAuth = `Bearer ${liveToken}`
const orderSql = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => index + 1).join(',')}]::smallint[]`,
)

async function cleanup(targetDate = liveDate) {
  await getDatabase().execute(sql`
    delete from daily_challenges where challenge_date = ${targetDate}::date
  `)
}

async function setPlacement(
  roundNumber: number,
  bagCount: number,
  bombBagNumber: number,
  coinBagNumbers: readonly number[],
) {
  const coinsSql = sql.raw(`array[${coinBagNumbers.join(',')}]::smallint[]`)
  await getDatabase().execute(sql`
    update daily_challenge_placements
    set
      bag_count = ${bagCount}::smallint,
      bomb_bag_number = ${bombBagNumber}::smallint,
      coin_bag_numbers = ${coinsSql}
    where challenge_date = ${liveDate}::date
      and round_number = ${roundNumber}::smallint
  `)
}

/** Align active started_at so claimed remainingSecondsAtTap is currently valid. */
async function alignStartForRemaining(remainingSecondsAtTap: number) {
  const elapsed = 60 - remainingSecondsAtTap
  await getDatabase().execute(sql`
    update daily_challenge_round_attempts
    set started_at =
      statement_timestamp() - make_interval(secs => ${elapsed})
    where participant_id = (
      select id from daily_challenge_participants
      where auth_token_hash = ${liveHash}
        and challenge_date = ${liveDate}::date
    )
      and status = 'active'
  `)
}

/** Start next ROUND via API, then align timing for an immediate OPEN at R=58. */
async function startRound() {
  const start = createDailyRoundStartHandler()
  const res = await start(
    new Request(
      `https://example.test/api/daily/challenges/${liveDate}/rounds/start`,
      {
        method: 'POST',
        headers: {
          Authorization: liveAuth,
          'Idempotency-Key': randomUUID(),
        },
      },
    ),
  )
  assert.equal(res.status, 200, await res.clone().text())
  await alignStartForRemaining(58)
}

await cleanup()
await persistOrLoadDailyQuestionSet({
  challengeDate: liveDate,
  rounds: provideDailyQuestionRounds(),
})
await getDatabase().execute(sql`
  insert into daily_challenge_participants (
    challenge_date, display_nickname, nickname_key, auth_token_hash,
    join_request_id, question_order
  ) values (
    ${liveDate}::date, 'ApiOpen', 'apiopen', ${liveHash},
    ${liveJoin}::uuid, ${orderSql}
  )
`)

const openLive = liveOpen()
const cashLive = liveCash()
await setPlacement(1, 5, 5, [2, 2, 3])
await startRound()

const openKey = randomUUID()
const coinOpen = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': openKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 58 }),
    },
  ),
)
assert.equal(coinOpen.status, 200, await coinOpen.clone().text())
const coinBody = (await coinOpen.json()) as {
  outcome: string
  coinsFound: number
  provisionalCoins: number
  roundEnded: boolean
  participantId?: string
}
assert.equal(coinBody.outcome, 'coins')
assert.equal(coinBody.coinsFound, 2)
assert.equal(coinBody.provisionalCoins, 2)
assert.equal(coinBody.roundEnded, false)
assert.equal(coinBody.participantId, undefined)
assert.doesNotMatch(JSON.stringify(coinBody), /bombBag|coinBagNumbers/)

// Idempotent replay
const replay = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': openKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 58 }),
    },
  ),
)
assert.equal(replay.status, 200)
assert.deepEqual(
  ((await replay.json()) as { coinsFound: number }).coinsFound,
  2,
)

// Same request, different bag
const sameReqOtherBag = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': openKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 3, remainingSecondsAtTap: 57 }),
    },
  ),
)
assert.equal(sameReqOtherBag.status, 409)

// Different request, same bag
const otherReqSameBag = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 2, remainingSecondsAtTap: 57 }),
    },
  ),
)
assert.equal(otherReqSameBag.status, 409)

// Empty bag
await alignStartForRemaining(56)
const emptyOpen = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 56 }),
    },
  ),
)
assert.equal(emptyOpen.status, 200)
assert.equal(((await emptyOpen.json()) as { outcome: string }).outcome, 'empty')

// Cash-out with 2 coins
await alignStartForRemaining(54)
const cashKey = randomUUID()
const cashRes = await cashLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': cashKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 54 }),
    },
  ),
)
assert.equal(cashRes.status, 200, await cashRes.clone().text())
const cashBody = (await cashRes.json()) as {
  endReason: string
  capturedCoins: number
  participantCompleted: boolean
}
assert.equal(cashBody.endReason, 'cashed_out')
assert.equal(cashBody.capturedCoins, 2)
assert.equal(cashBody.participantCompleted, false)

const cashReplay = await cashLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': cashKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 54 }),
    },
  ),
)
assert.equal(cashReplay.status, 200)

// Post cash-out OPEN rejected
const afterCashOpen = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 3, remainingSecondsAtTap: 50 }),
    },
  ),
)
assert.equal(afterCashOpen.status, 409)

// New round: bomb + clear + zero cash reject + auth fail
await startRound()
await setPlacement(2, 5, 5, [1, 2, 3])

const zeroCash = await cashLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 58 }),
    },
  ),
)
assert.equal(zeroCash.status, 409)

await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 58 }),
    },
  ),
)
await alignStartForRemaining(56)
const bombRes = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 5, remainingSecondsAtTap: 56 }),
    },
  ),
)
assert.equal(bombRes.status, 200)
const bombBody = (await bombRes.json()) as {
  outcome: string
  endReason: string
  capturedCoins: number
  roundEnded: boolean
}
assert.equal(bombBody.outcome, 'bomb')
assert.equal(bombBody.endReason, 'bombed')
assert.equal(bombBody.capturedCoins, 0)
assert.equal(bombBody.roundEnded, true)

const afterBombCash = await cashLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 55 }),
    },
  ),
)
assert.equal(afterBombCash.status, 409)

// 3COINS COMPLETE
await startRound()
await setPlacement(3, 4, 4, [1, 1, 1])
const clearRes = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 58 }),
    },
  ),
)
assert.equal(clearRes.status, 200)
const clearBody = (await clearRes.json()) as {
  endReason: string
  capturedCoins: number
  coinsFound: number
}
assert.equal(clearBody.endReason, 'cleared')
assert.equal(clearBody.capturedCoins, 3)
assert.equal(clearBody.coinsFound, 3)

const afterClearCash = await cashLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ remainingSecondsAtTap: 55 }),
    },
  ),
)
assert.equal(afterClearCash.status, 409)

// Wrong capability
const badAuth = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 60 }),
    },
  ),
)
assert.ok(badAuth.status === 404 || badAuth.status === 409)

// TIME OUT boundary: force started_at 63s ago, then OPEN must conflict
await startRound()
await getDatabase().execute(sql`
  update daily_challenge_round_attempts
  set started_at = statement_timestamp() - interval '63 seconds'
  where participant_id = (
    select id from daily_challenge_participants
    where auth_token_hash = ${liveHash}
      and challenge_date = ${liveDate}::date
  )
    and status = 'active'
`)
await setPlacement(4, 5, 5, [1, 2, 3])
const timedOutOpen = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 1 }),
    },
  ),
)
assert.equal(timedOutOpen.status, 409)

// ROUND20 completion via cash-out through API
await cleanup()
await persistOrLoadDailyQuestionSet({
  challengeDate: liveDate,
  rounds: provideDailyQuestionRounds(),
})
await getDatabase().execute(sql`
  insert into daily_challenge_participants (
    challenge_date, display_nickname, nickname_key, auth_token_hash,
    join_request_id, question_order
  ) values (
    ${liveDate}::date, 'ApiR20', 'apir20', ${liveHash},
    ${liveJoin}::uuid, ${orderSql}
  )
`)

for (let round = 1; round <= 20; round += 1) {
  await setPlacement(round, 4, 4, [1, 2, 3])
  await startRound()
  const openR = await openLive(
    new Request(
      `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
      {
        method: 'POST',
        headers: {
          Authorization: liveAuth,
          'Idempotency-Key': randomUUID(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 58 }),
      },
    ),
  )
  assert.equal(openR.status, 200, `round ${round} open`)
  await alignStartForRemaining(56)
  const cashR = await cashLive(
    new Request(
      `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
      {
        method: 'POST',
        headers: {
          Authorization: liveAuth,
          'Idempotency-Key': randomUUID(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ remainingSecondsAtTap: 56 }),
      },
    ),
  )
  assert.equal(cashR.status, 200, `round ${round} cash`)
  const body = (await cashR.json()) as { participantCompleted: boolean }
  if (round < 20) assert.equal(body.participantCompleted, false)
  else assert.equal(body.participantCompleted, true)
}

const afterComplete = await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 58 }),
    },
  ),
)
assert.equal(afterComplete.status, 409)

// Concurrent bomb OPEN vs cash-out (Promise.all)
await cleanup()
await persistOrLoadDailyQuestionSet({
  challengeDate: liveDate,
  rounds: provideDailyQuestionRounds(),
})
await getDatabase().execute(sql`
  insert into daily_challenge_participants (
    challenge_date, display_nickname, nickname_key, auth_token_hash,
    join_request_id, question_order
  ) values (
    ${liveDate}::date, 'ApiRace', 'apirace', ${liveHash},
    ${liveJoin}::uuid, ${orderSql}
  )
`)
await setPlacement(1, 5, 5, [1, 2, 3])
await startRound()
await openLive(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
    {
      method: 'POST',
      headers: {
        Authorization: liveAuth,
        'Idempotency-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bagNumber: 1, remainingSecondsAtTap: 58 }),
    },
  ),
)
await alignStartForRemaining(56)
const [raceBomb, raceCash] = await Promise.all([
  openLive(
    new Request(
      `https://example.test/api/daily/challenges/${liveDate}/rounds/open`,
      {
        method: 'POST',
        headers: {
          Authorization: liveAuth,
          'Idempotency-Key': randomUUID(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bagNumber: 5, remainingSecondsAtTap: 56 }),
      },
    ),
  ),
  cashLive(
    new Request(
      `https://example.test/api/daily/challenges/${liveDate}/rounds/cash-out`,
      {
        method: 'POST',
        headers: {
          Authorization: liveAuth,
          'Idempotency-Key': randomUUID(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ remainingSecondsAtTap: 56 }),
      },
    ),
  ),
])
const raceOk = [raceBomb, raceCash].filter((r) => r.status === 200)
const raceConflict = [raceBomb, raceCash].filter((r) => r.status === 409)
assert.equal(raceOk.length, 1)
assert.equal(raceConflict.length, 1)

await cleanup()
console.log('verify:daily-open-cashout-api OK (handlers+Neon dev)')
