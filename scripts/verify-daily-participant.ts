/** DAILY participant token, order, JOIN idempotency, and DB-layer checks. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DAILY_PARTICIPANT_TOKEN_PREFIX,
  deriveDailyParticipantCapability,
  deriveDailyQuestionOrder,
  hashDailyParticipantCapability,
  validateDailyParticipantCapability,
} from '../server/auth/dailyTokens.ts'
import {
  authenticateDailyParticipant,
  createDailyQuestionOrder,
  DailyParticipantError,
  registerDailyParticipant,
} from '../server/daily/dailyParticipant.ts'
import type {
  DailyParticipantRecord,
  PersistDailyParticipantInput,
} from '../server/db/dailyParticipants.ts'

const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x64).toString('base64url'),
}
const date = '2026-10-14'
const requestA = randomUUID()
const requestB = randomUUID()
const tokenA = deriveDailyParticipantCapability(date, requestA, environment)

assert.match(tokenA, new RegExp(`^${DAILY_PARTICIPANT_TOKEN_PREFIX}`))
assert.equal(tokenA, deriveDailyParticipantCapability(date, requestA, environment))
assert.notEqual(tokenA, deriveDailyParticipantCapability(date, requestB, environment))
assert.notEqual(
  tokenA,
  deriveDailyParticipantCapability('2026-10-15', requestA, environment),
)
assert.equal(validateDailyParticipantCapability(tokenA), tokenA)
assert.match(hashDailyParticipantCapability(tokenA), /^[0-9a-f]{64}$/)
assert.throws(() => validateDailyParticipantCapability('bad'))
assert.throws(() => hashDailyParticipantCapability('bad'))
assert.deepEqual(
  deriveDailyQuestionOrder(date, requestA, environment),
  deriveDailyQuestionOrder(date, requestA, environment),
)
assert.notDeepEqual(
  deriveDailyQuestionOrder(date, requestA, environment),
  deriveDailyQuestionOrder(date, requestB, environment),
)
assert.deepEqual(
  [...deriveDailyQuestionOrder(date, requestA, environment)].sort((a, b) => a - b),
  Array.from({ length: 20 }, (_, index) => index + 1),
)

const order = createDailyQuestionOrder(() => 0)
assert.equal(order.length, 20)
assert.deepEqual([...order].sort((a, b) => a - b), [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
])
assert.throws(() => createDailyQuestionOrder(() => -1), DailyParticipantError)
assert.throws(() => createDailyQuestionOrder((max) => max), DailyParticipantError)

const stored = new Map<string, DailyParticipantRecord>()
const persistedInputs: PersistDailyParticipantInput[] = []
let participantSequence = 0
const persist = async (
  input: PersistDailyParticipantInput,
): Promise<DailyParticipantRecord> => {
  persistedInputs.push(input)
  const existing = stored.get(input.joinRequestId)
  if (existing) return existing
  participantSequence += 1
  const created: DailyParticipantRecord = {
    participantId: `participant-${participantSequence}`,
    challengeDate: input.challengeDate,
    displayNickname: input.displayNickname,
    questionOrder: [...input.questionOrder],
    acceptedAt: `2026-10-14T00:00:0${participantSequence}.000Z`,
    completedAt: null,
    expiredAt: null,
  }
  stored.set(input.joinRequestId, created)
  return created
}
let ensuredDates: string[] = []
const ensureQuestionSet = async (challengeDate: string) => {
  ensuredDates.push(challengeDate)
  return {} as never
}

const first = await registerDailyParticipant('Cafe\u0301', requestA, {
  now: new Date('2026-10-14T23:59:59.999Z'),
  ensureQuestionSet,
  persist,
  environment,
})
const retried = await registerDailyParticipant('Different', requestA, {
  now: new Date('2026-10-14T23:59:59.999Z'),
  ensureQuestionSet,
  persist,
  environment,
})
const other = await registerDailyParticipant('Cafe\u0301', requestB, {
  now: new Date('2026-10-14T23:59:59.999Z'),
  ensureQuestionSet,
  persist,
  environment,
})

assert.equal(first.token, tokenA)
assert.equal(retried.token, tokenA)
assert.equal(retried.participantId, first.participantId)
assert.deepEqual(retried.questionOrder, first.questionOrder)
assert.deepEqual(persistedInputs[1]?.questionOrder, persistedInputs[0]?.questionOrder)
assert.equal(retried.acceptedAt, first.acceptedAt)
assert.notEqual(other.participantId, first.participantId)
assert.notEqual(other.token, first.token)
assert.equal(first.displayNickname, 'Cafe\u0301')
assert.equal(persistedInputs[0]?.nicknameKey, 'Café')
assert.equal(persistedInputs[1]?.nicknameKey, 'Different')
assert.equal(persistedInputs[2]?.nicknameKey, 'Café')
assert.deepEqual(ensuredDates, [date, date, date])
assert.equal(stored.size, 2)

for (const invalidNickname of ['', 'A B', '🙂', 'A!', 'Ａ']) {
  await assert.rejects(
    registerDailyParticipant(invalidNickname, randomUUID(), {
      now: new Date('2026-10-14T12:00:00.000Z'),
      ensureQuestionSet,
      persist,
      environment,
    }),
    DailyParticipantError,
  )
}
await assert.rejects(
  registerDailyParticipant('Valid', 'not-a-request-id', {
    now: new Date('2026-10-14T12:00:00.000Z'),
    ensureQuestionSet,
    persist,
    environment,
  }),
  DailyParticipantError,
)

const beforeBoundary = await registerDailyParticipant('Before', randomUUID(), {
  now: new Date('2026-10-14T23:59:59.999Z'),
  ensureQuestionSet,
  persist,
  environment,
})
const atBoundary = await registerDailyParticipant('After', randomUUID(), {
  now: new Date('2026-10-15T00:00:00.000Z'),
  ensureQuestionSet,
  persist,
  environment,
})
assert.equal(beforeBoundary.challengeDate, '2026-10-14')
assert.equal(atBoundary.challengeDate, '2026-10-15')

const authenticated = await authenticateDailyParticipant(
  date,
  tokenA,
  async ({ challengeDate, authTokenHash }) =>
    challengeDate === date &&
    authTokenHash === hashDailyParticipantCapability(tokenA)
      ? first
      : null,
)
assert.equal(authenticated?.participantId, first.participantId)
assert.equal(
  await authenticateDailyParticipant('2026-10-15', tokenA, async () => null),
  null,
)
assert.equal(await authenticateDailyParticipant(date, 'bad', async () => first), null)

const root = resolve(import.meta.dirname, '..')
const dbSource = readFileSync(
  resolve(root, 'server/db/dailyParticipants.ts'),
  'utf8',
)
assert.match(dbSource, /having count\(placement\.round_number\) =/)
assert.match(dbSource, /on conflict \(join_request_id\) do update/)
assert.match(dbSource, /set join_request_id = excluded\.join_request_id/)
assert.match(dbSource, /challenge_date = excluded\.challenge_date/)
assert.match(dbSource, /auth_token_hash = excluded\.auth_token_hash/)
assert.match(dbSource, /participant\.challenge_date = /)
assert.match(dbSource, /participant\.auth_token_hash = /)
assert.doesNotMatch(dbSource, /console\./)

console.log('verify:daily-participant OK')
