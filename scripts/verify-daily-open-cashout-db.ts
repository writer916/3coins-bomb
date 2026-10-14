/**
 * DAILY OPEN + cash-out DB layer: source guards and Neon dev transactional checks.
 * Leaves no durable rows (challenge date deleted after each scenario).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  dailyChallengePeriod,
  validateDailyOperationTiming,
  DAILY_OPERATION_GRACE_SECONDS,
  DAILY_ROUND_LIMIT_SECONDS,
} from '../src/daily/dailyTime.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import { hashDailyParticipantCapability } from '../server/auth/dailyTokens.ts'

const root = resolve(import.meta.dirname, '..')
const openSource = readFileSync(resolve(root, 'server/db/openDailyBag.ts'), 'utf8')
const cashSource = readFileSync(
  resolve(root, 'server/db/cashOutDailyRound.ts'),
  'utf8',
)

for (const fragment of [
  'export async function openDailyBag',
  'for update of participant',
  'timed_out',
  'make_interval(secs =>',
  'remaining_seconds_at_tap',
  'insert into daily_challenge_round_opens',
  'on conflict do nothing',
  'unnest(target.coin_bag_numbers)',
  "then 'bombed'",
  "then 'cleared'",
  'coin_bag_hits',
  'terminal_request_id',
  'completed_at',
]) {
  assert.ok(openSource.includes(fragment), fragment)
}

for (const fragment of [
  'export async function cashOutDailyRound',
  'for update of participant',
  'timed_out',
  "status = 'cashed_out'",
  'provisional_coins in (1, 2)',
  'terminal_request_id',
  'elapsed_seconds',
  'coin_bag_hits',
  'completed_at',
]) {
  assert.ok(cashSource.includes(fragment), fragment)
}

assert.doesNotMatch(openSource, /console\./)
assert.doesNotMatch(cashSource, /console\./)
// Response views must not expose placement coordinates.
assert.doesNotMatch(openSource, /bombBagNumber|coinBagNumbers/)
assert.doesNotMatch(cashSource, /bombBagNumber|coinBagNumbers/)
assert.match(openSource, /bomb_bag_number/)
assert.match(openSource, /coin_bag_numbers/)

assert.equal(DAILY_ROUND_LIMIT_SECONDS + DAILY_OPERATION_GRACE_SECONDS, 62)
assert.equal(DAILY_CHALLENGE_ROUNDS, 20)

const started = Date.parse('2099-08-01T12:00:00.000Z')
const dayEnd = dailyChallengePeriod('2099-08-01').endsAtMs
assert.equal(
  validateDailyOperationTiming({
    startedAtMs: started,
    receivedAtMs: started + 61_500,
    remainingSecondsAtTap: 1,
    challengeEndsAtMs: dayEnd,
  }).accepted,
  true,
)
assert.equal(
  validateDailyOperationTiming({
    startedAtMs: started,
    receivedAtMs: started + 62_000,
    remainingSecondsAtTap: 1,
    challengeEndsAtMs: dayEnd,
  }).accepted,
  false,
)

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
  console.log('verify:daily-open-cashout-db OK (source; Neon dev skipped)')
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
const { startDailyRound, getDailyPlayState } = await import(
  '../server/db/dailyPlay.ts'
)
const { openDailyBag } = await import('../server/db/openDailyBag.ts')
const { cashOutDailyRound } = await import('../server/db/cashOutDailyRound.ts')

const date = '2099-08-01'
const orderSql = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => index + 1).join(',')}]::smallint[]`,
)

async function cleanup(targetDate: string) {
  await getDatabase().execute(sql`
    delete from daily_challenges where challenge_date = ${targetDate}::date
  `)
}

async function seedParticipant(nickname: string, tokenSuffix: string) {
  const token = `3cb_dp1_${tokenSuffix}`
  const hash = hashDailyParticipantCapability(token)
  await persistOrLoadDailyQuestionSet({
    challengeDate: date,
    rounds: provideDailyQuestionRounds(),
  })
  const inserted = await getDatabase().execute<{ id: string }>(sql`
    insert into daily_challenge_participants (
      challenge_date,
      display_nickname,
      nickname_key,
      auth_token_hash,
      join_request_id,
      question_order
    ) values (
      ${date}::date,
      ${nickname},
      ${nickname.toLowerCase()},
      ${hash},
      ${randomUUID()}::uuid,
      ${orderSql}
    )
    returning id
  `)
  assert.ok(inserted.rows[0]?.id)
  return { hash, participantId: inserted.rows[0]!.id }
}

/** Force placement for challenge_round_number = play round (identity order). */
async function setPlacement(
  roundNumber: number,
  bagCount: number,
  bombBagNumber: number,
  coinBagNumbers: readonly number[],
) {
  const coinsSql = sql.raw(
    `array[${coinBagNumbers.join(',')}]::smallint[]`,
  )
  await getDatabase().execute(sql`
    update daily_challenge_placements
    set
      bag_count = ${bagCount}::smallint,
      bomb_bag_number = ${bombBagNumber}::smallint,
      coin_bag_numbers = ${coinsSql}
    where challenge_date = ${date}::date
      and round_number = ${roundNumber}::smallint
  `)
}

async function readAttempt(participantId: string, roundNumber: number) {
  const result = await getDatabase().execute<{
    status: string
    captured_coins: number | null
    opened_bag_count: number
    coin_bag_hits: number | null
    elapsed_seconds: number | null
  }>(sql`
    select status, captured_coins, opened_bag_count, coin_bag_hits, elapsed_seconds
    from daily_challenge_round_attempts
    where participant_id = ${participantId}::uuid
      and round_number = ${roundNumber}::smallint
  `)
  return result.rows[0]!
}

async function readOpenCount(participantId: string, roundNumber: number) {
  const result = await getDatabase().execute<{ n: number }>(sql`
    select count(*)::integer as n
    from daily_challenge_round_opens
    where participant_id = ${participantId}::uuid
      and round_number = ${roundNumber}::smallint
  `)
  return Number(result.rows[0]!.n)
}

async function assertNoPlacementLeak(value: unknown) {
  const text = JSON.stringify(value)
  assert.doesNotMatch(text, /bomb_bag_number/i)
  assert.doesNotMatch(text, /coin_bag_numbers/i)
  assert.doesNotMatch(text, /bombBagNumber/)
  assert.doesNotMatch(text, /coinBagNumbers/)
}

await cleanup(date)

// --- Empty / 1 / 2 / 3 coin bags + bomb + clear ---
{
  const { hash, participantId } = await seedParticipant('OpenA', `${'A'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [2, 2, 3])
  const t0 = Date.parse('2099-08-01T12:00:00.000Z')
  const started = await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  assert.equal(started.status, 'started')

  const empty = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 55,
    nowMs: t0 + 5_000,
  })
  assert.equal(empty.status, 'opened')
  if (empty.status !== 'opened') throw new Error('expected opened')
  assert.equal(empty.view.outcome, 'empty')
  assert.equal(empty.view.coinsFound, 0)
  assert.equal(empty.view.provisionalCoins, 0)
  assert.equal(empty.view.roundEnded, false)
  await assertNoPlacementLeak(empty.view)

  const two = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 2,
    remainingSecondsAtTap: 50,
    nowMs: t0 + 10_000,
  })
  assert.equal(two.status, 'opened')
  if (two.status !== 'opened') throw new Error('expected opened')
  assert.equal(two.view.outcome, 'coins')
  assert.equal(two.view.coinsFound, 2)
  assert.equal(two.view.provisionalCoins, 2)
  assert.equal(two.view.roundEnded, false)

  const clear = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 3,
    remainingSecondsAtTap: 45,
    nowMs: t0 + 15_000,
  })
  assert.equal(clear.status, 'opened')
  if (clear.status !== 'opened') throw new Error('expected opened')
  assert.equal(clear.view.outcome, 'coins')
  assert.equal(clear.view.coinsFound, 1)
  assert.equal(clear.view.provisionalCoins, 3)
  assert.equal(clear.view.roundEnded, true)
  assert.equal(clear.view.endReason, 'cleared')
  assert.equal(clear.view.capturedCoins, 3)
  assert.equal(clear.view.elapsedSeconds, 15)
  assert.equal(clear.view.coinBagHits, 2)
  const attempt = await readAttempt(participantId, 1)
  assert.equal(attempt.status, 'cleared')
  assert.equal(attempt.opened_bag_count, await readOpenCount(participantId, 1))
  assert.equal(attempt.coin_bag_hits, 2)
}

await cleanup(date)

// --- Triple-coin bag clear in one OPEN ---
{
  const { hash, participantId } = await seedParticipant('OpenB', `${'B'.repeat(42)}A`)
  await setPlacement(1, 4, 4, [1, 1, 1])
  const t0 = Date.parse('2099-08-01T12:10:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  const hit = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 60,
    nowMs: t0,
  })
  assert.equal(hit.status, 'opened')
  if (hit.status !== 'opened') throw new Error('expected opened')
  assert.equal(hit.view.coinsFound, 3)
  assert.equal(hit.view.endReason, 'cleared')
  assert.equal(hit.view.coinBagHits, 1)
  assert.equal((await readAttempt(participantId, 1)).status, 'cleared')
}

await cleanup(date)

// --- OPEN vs GET play mid-active outcome parity (Neon) ---
{
  const { hash } = await seedParticipant('ParityA', `${'P'.repeat(42)}A`)
  const other = await seedParticipant('ParityB', `${'Q'.repeat(42)}A`)
  // bag2 holds COIN×2; bag3 COIN×1; bomb=6; bag1/4/5 empty — stay active after empty+multi.
  await setPlacement(1, 6, 6, [2, 2, 3])
  const t0 = Date.parse('2099-08-01T12:15:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })

  const empty = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 55,
    nowMs: t0 + 5_000,
  })
  assert.equal(empty.status, 'opened')
  if (empty.status !== 'opened') throw new Error('expected opened')
  assert.equal(empty.view.outcome, 'empty')
  assert.equal(empty.view.coinsFound, 0)

  const afterEmpty = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: hash,
    nowMs: t0 + 5_500,
  })
  assert.ok(afterEmpty?.activeAttempt)
  assert.equal(afterEmpty!.activeAttempt!.opens.length, 1)
  assert.equal(afterEmpty!.activeAttempt!.opens[0]!.outcome, empty.view.outcome)
  assert.equal(afterEmpty!.activeAttempt!.opens[0]!.coinsFound, empty.view.coinsFound)
  assert.equal(afterEmpty!.activeAttempt!.opens[0]!.bagNumber, empty.view.bagNumber)
  assert.equal(afterEmpty!.activeAttempt!.opens[0]!.openOrder, empty.view.openOrder)
  await assertNoPlacementLeak(afterEmpty)
  assert.equal(
    afterEmpty!.activeAttempt!.opens.some((open) => open.bagNumber !== 1),
    false,
    'unopened bags must not appear in GET play opens',
  )

  const multi = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 2,
    remainingSecondsAtTap: 50,
    nowMs: t0 + 10_000,
  })
  assert.equal(multi.status, 'opened')
  if (multi.status !== 'opened') throw new Error('expected opened')
  assert.equal(multi.view.outcome, 'coins')
  assert.equal(multi.view.coinsFound, 2)
  assert.equal(multi.view.roundEnded, false)

  const afterMulti = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: hash,
    nowMs: t0 + 10_500,
  })
  assert.ok(afterMulti?.activeAttempt)
  assert.equal(afterMulti!.activeAttempt!.opens.length, 2)
  const playEmpty = afterMulti!.activeAttempt!.opens.find((o) => o.openOrder === 1)!
  const playMulti = afterMulti!.activeAttempt!.opens.find((o) => o.openOrder === 2)!
  assert.equal(playEmpty.outcome, empty.view.outcome)
  assert.equal(playEmpty.coinsFound, empty.view.coinsFound)
  assert.equal(playMulti.outcome, multi.view.outcome)
  assert.equal(playMulti.coinsFound, multi.view.coinsFound)
  assert.equal(playMulti.bagNumber, 2)
  await assertNoPlacementLeak(afterMulti)
  assert.equal(
    afterMulti!.activeAttempt!.opens.some((open) =>
      [3, 4, 5, 6].includes(open.bagNumber),
    ),
    false,
    'unopened coin/bomb bags must not leak via opens',
  )

  const otherState = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: other.hash,
    nowMs: t0 + 10_500,
  })
  assert.ok(otherState, 'other joined participant must resolve')
  assert.equal(otherState!.activeAttempt, null)
  assert.equal(otherState!.completedRounds, 0)
  await assertNoPlacementLeak(otherState)
  assert.doesNotMatch(
    JSON.stringify(otherState),
    /"opens":\s*\[\s*\{/,
    'other participant must not receive ParityA opens',
  )

  const bomb = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 6,
    remainingSecondsAtTap: 45,
    nowMs: t0 + 15_000,
  })
  assert.equal(bomb.status, 'opened')
  if (bomb.status !== 'opened') throw new Error('expected opened')
  assert.equal(bomb.view.outcome, 'bomb')
  assert.equal(bomb.view.coinsFound, 0)
  assert.equal(bomb.view.roundEnded, true)
  // BOMB ends the attempt — GET play drops active opens by design; assert terminal + no leak.
  const afterBomb = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: hash,
    nowMs: t0 + 15_500,
  })
  assert.equal(afterBomb?.activeAttempt, null)
  assert.equal(afterBomb?.completedRounds, 1)
  await assertNoPlacementLeak(afterBomb)
}

await cleanup(date)

// --- BOMB zeros coins; prior opens retained for HIT RATE ---
{
  const { hash, participantId } = await seedParticipant('OpenC', `${'C'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T12:20:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  const coin = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 58,
    nowMs: t0 + 2_000,
  })
  assert.equal(coin.status, 'opened')
  if (coin.status !== 'opened') throw new Error('expected opened')
  assert.equal(coin.view.provisionalCoins, 1)

  // Mid-active GET must mirror the COIN open before BOMB ends the ROUND.
  const midBeforeBomb = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: hash,
    nowMs: t0 + 2_500,
  })
  assert.ok(midBeforeBomb?.activeAttempt)
  assert.equal(midBeforeBomb!.activeAttempt!.opens.length, 1)
  assert.equal(midBeforeBomb!.activeAttempt!.opens[0]!.outcome, coin.view.outcome)
  assert.equal(midBeforeBomb!.activeAttempt!.opens[0]!.coinsFound, coin.view.coinsFound)

  const bomb = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 5,
    remainingSecondsAtTap: 50,
    nowMs: t0 + 10_000,
  })
  assert.equal(bomb.status, 'opened')
  if (bomb.status !== 'opened') throw new Error('expected opened')
  assert.equal(bomb.view.outcome, 'bomb')
  assert.equal(bomb.view.capturedCoins, 0)
  assert.equal(bomb.view.endReason, 'bombed')
  assert.equal(bomb.view.coinBagHits, 1)
  assert.equal(await readOpenCount(participantId, 1), 2)
  assert.equal((await readAttempt(participantId, 1)).captured_coins, 0)
}

await cleanup(date)

// --- Cash-out 1 / 2; reject 0 ---
{
  const { hash, participantId } = await seedParticipant('CashA', `${'D'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T12:30:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })

  const zeroCash = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    remainingSecondsAtTap: 55,
    nowMs: t0 + 5_000,
  })
  assert.equal(zeroCash.status, 'conflict')

  await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 54,
    nowMs: t0 + 6_000,
  })
  const cash1Id = randomUUID()
  const cash1 = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: cash1Id,
    remainingSecondsAtTap: 50,
    nowMs: t0 + 10_000,
  })
  assert.equal(cash1.status, 'cashed_out')
  if (cash1.status !== 'cashed_out') throw new Error('expected cashed_out')
  assert.equal(cash1.view.capturedCoins, 1)
  assert.equal(cash1.view.elapsedSeconds, 10)
  assert.equal(cash1.view.coinBagHits, 1)
  await assertNoPlacementLeak(cash1.view)

  const cash1Retry = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: cash1Id,
    remainingSecondsAtTap: 50,
    nowMs: t0 + 11_000,
  })
  assert.equal(cash1Retry.status, 'retry')
  if (cash1Retry.status !== 'retry') throw new Error('expected retry')
  assert.equal(cash1Retry.view.capturedCoins, 1)
  assert.equal((await readAttempt(participantId, 1)).status, 'cashed_out')
}

await cleanup(date)

{
  const { hash } = await seedParticipant('CashB', `${'E'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 1, 2])
  const t0 = Date.parse('2099-08-01T12:40:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 55,
    nowMs: t0 + 5_000,
  })
  const cash2 = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    remainingSecondsAtTap: 40,
    nowMs: t0 + 20_000,
  })
  assert.equal(cash2.status, 'cashed_out')
  if (cash2.status !== 'cashed_out') throw new Error('expected cashed_out')
  assert.equal(cash2.view.capturedCoins, 2)
  assert.equal(cash2.view.coinBagHits, 1)
}

await cleanup(date)

// --- Idempotent OPEN + same-bag / same-request conflicts ---
{
  const { hash, participantId } = await seedParticipant('Idem', `${'F'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T12:50:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  const req = randomUUID()
  const first = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: req,
    bagNumber: 1,
    remainingSecondsAtTap: 60,
    nowMs: t0,
  })
  assert.equal(first.status, 'opened')
  const replay = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: req,
    bagNumber: 1,
    remainingSecondsAtTap: 60,
    nowMs: t0 + 100,
  })
  assert.equal(replay.status, 'retry')
  assert.equal(await readOpenCount(participantId, 1), 1)

  const sameReqOtherBag = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: req,
    bagNumber: 2,
    remainingSecondsAtTap: 59,
    nowMs: t0 + 1_000,
  })
  assert.equal(sameReqOtherBag.status, 'conflict')

  const otherReqSameBag = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 58,
    nowMs: t0 + 2_000,
  })
  assert.equal(otherReqSameBag.status, 'conflict')
}

await cleanup(date)

// --- Concurrent different bags (serialized by participant lock) ---
{
  const { hash, participantId } = await seedParticipant('Conc', `${'G'.repeat(42)}A`)
  await setPlacement(1, 6, 6, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T13:00:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  const [a, b] = await Promise.all([
    openDailyBag({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      bagNumber: 1,
      remainingSecondsAtTap: 55,
      nowMs: t0 + 5_000,
    }),
    openDailyBag({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      bagNumber: 2,
      remainingSecondsAtTap: 55,
      nowMs: t0 + 5_000,
    }),
  ])
  assert.equal(a.status, 'opened')
  assert.equal(b.status, 'opened')
  assert.equal(await readOpenCount(participantId, 1), 2)
  assert.equal((await readAttempt(participantId, 1)).opened_bag_count, 2)
}

await cleanup(date)

// --- OPEN(bomb) vs cash-out race: exactly one terminal winner ---
{
  const { hash, participantId } = await seedParticipant('Race', `${'H'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T13:10:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 55,
    nowMs: t0 + 5_000,
  })
  const [bombOpen, cash] = await Promise.all([
    openDailyBag({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      bagNumber: 5,
      remainingSecondsAtTap: 50,
      nowMs: t0 + 10_000,
    }),
    cashOutDailyRound({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      remainingSecondsAtTap: 50,
      nowMs: t0 + 10_000,
    }),
  ])
  const successes = [bombOpen, cash].filter(
    (result) =>
      result.status === 'opened' ||
      result.status === 'cashed_out' ||
      result.status === 'retry',
  )
  const conflicts = [bombOpen, cash].filter((result) => result.status === 'conflict')
  assert.equal(successes.length, 1)
  assert.equal(conflicts.length, 1)
  const terminal = await readAttempt(participantId, 1)
  if (cash.status === 'cashed_out') {
    assert.equal(terminal.status, 'cashed_out')
    assert.equal(terminal.captured_coins, 1)
  } else {
    assert.equal(bombOpen.status, 'opened')
    assert.equal(terminal.status, 'bombed')
    assert.equal(terminal.captured_coins, 0)
  }
}

await cleanup(date)

// --- Timing boundaries ---
{
  const { hash } = await seedParticipant('Time', `${'I'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const t0 = Date.parse('2099-08-01T13:20:00.000Z')
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })

  const r60 = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 4,
    remainingSecondsAtTap: 60,
    nowMs: t0,
  })
  assert.equal(r60.status, 'opened')

  const r0 = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 0,
    nowMs: t0 + 1_000,
  })
  assert.equal(r0.status, 'conflict')

  const graceOk = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 1,
    nowMs: t0 + 61_500,
  })
  assert.equal(graceOk.status, 'opened')

  const after62 = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 2,
    remainingSecondsAtTap: 1,
    nowMs: t0 + 62_000,
  })
  assert.equal(after62.status, 'conflict')

  const state = await getDailyPlayState({
    challengeDate: date,
    authTokenHash: hash,
    nowMs: t0 + 62_000,
  })
  assert.equal(state?.activeAttempt, null)
  assert.equal(state?.completedRounds, 1)

  const afterTimeout = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    remainingSecondsAtTap: 1,
    nowMs: t0 + 63_000,
  })
  assert.equal(afterTimeout.status, 'conflict')
}

await cleanup(date)

// --- UTC day boundary: no grace ---
{
  const { hash } = await seedParticipant('DayEnd', `${'J'.repeat(42)}A`)
  await setPlacement(1, 5, 5, [1, 2, 3])
  const endsAt = dailyChallengePeriod(date).endsAtMs
  const t0 = endsAt - 30_000
  await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: t0,
  })
  const late = await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 40,
    nowMs: endsAt,
  })
  assert.equal(late.status, 'conflict')
}

await cleanup(date)

// --- ROUND 20 completion via cash-out ---
{
  const { hash, participantId } = await seedParticipant('R20', `${'K'.repeat(42)}A`)
  let cursor = Date.parse('2099-08-01T14:00:00.000Z')
  for (let round = 1; round <= 19; round += 1) {
    await setPlacement(round, 4, 4, [1, 2, 3])
    await startDailyRound({
      challengeDate: date,
      authTokenHash: hash,
      startRequestId: randomUUID(),
      nowMs: cursor,
    })
    await openDailyBag({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      bagNumber: 1,
      remainingSecondsAtTap: 55,
      nowMs: cursor + 5_000,
    })
    await cashOutDailyRound({
      challengeDate: date,
      authTokenHash: hash,
      requestId: randomUUID(),
      remainingSecondsAtTap: 50,
      nowMs: cursor + 10_000,
    })
    cursor += 30_000
  }
  await setPlacement(20, 4, 4, [1, 2, 3])
  const lastStart = await startDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    startRequestId: randomUUID(),
    nowMs: cursor,
  })
  assert.equal(lastStart.status, 'started')
  assert.equal(lastStart.state.activeAttempt?.roundNumber, 20)
  await openDailyBag({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    bagNumber: 1,
    remainingSecondsAtTap: 55,
    nowMs: cursor + 5_000,
  })
  const lastCash = await cashOutDailyRound({
    challengeDate: date,
    authTokenHash: hash,
    requestId: randomUUID(),
    remainingSecondsAtTap: 50,
    nowMs: cursor + 10_000,
  })
  assert.equal(lastCash.status, 'cashed_out')
  if (lastCash.status !== 'cashed_out') throw new Error('expected cashed_out')
  assert.equal(lastCash.view.participantCompleted, true)
  assert.equal(lastCash.view.roundNumber, 20)
  const participant = await getDatabase().execute<{
    completed_at: Date | string | null
  }>(sql`
    select completed_at from daily_challenge_participants
    where id = ${participantId}::uuid
  `)
  assert.ok(participant.rows[0]?.completed_at)
}

await cleanup(date)

console.log('verify:daily-open-cashout-db OK (source+Neon dev)')
