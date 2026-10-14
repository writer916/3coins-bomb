/** DAILY JOIN and participant retrieval API checks (no database connection). */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import dailyApi from '../api/daily.ts'
import { createDailyJoinHandler } from '../api/_daily/challenges/current/participants.ts'
import { createDailyParticipantHandler } from '../api/_daily/challenges/[date]/participant.ts'
import {
  getDailyParticipant,
  joinCurrentDailyChallenge,
} from '../server/daily/participantApi.ts'
import { deriveDailyParticipantCapability } from '../server/auth/dailyTokens.ts'

const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x61).toString('base64url'),
}
const date = '2026-10-14'
const requestA = randomUUID()
const requestB = randomUUID()
const tokenA = deriveDailyParticipantCapability(date, requestA, environment)
const tokenB = deriveDailyParticipantCapability(date, requestB, environment)
const acceptedAt = '2026-10-14T01:02:03.000Z'

const records = new Map<string, {
  readonly participantId: string
  readonly nickname: string
  readonly token: string
}>()
let sequence = 0
const joinHandler = createDailyJoinHandler(async (input) => {
  const existing = records.get(input.joinRequestId)
  if (existing) {
    return {
      challengeDate: date,
      participantId: existing.participantId,
      nickname: existing.nickname,
      token: existing.token,
      acceptedAt,
    }
  }
  sequence += 1
  const created = {
    participantId: `participant-${sequence}`,
    nickname: input.nickname,
    token: input.joinRequestId === requestA ? tokenA : tokenB,
  }
  records.set(input.joinRequestId, created)
  return { challengeDate: date, ...created, acceptedAt }
})

function joinRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/daily/challenges/current/participants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

const firstResponse = await joinHandler(
  joinRequest(JSON.stringify({ nickname: 'Same', joinRequestId: requestA })),
)
assert.equal(firstResponse.status, 201)
assert.equal(firstResponse.headers.get('cache-control'), 'no-store')
const first = await firstResponse.json() as Record<string, unknown>
assert.deepEqual(Object.keys(first).sort(), [
  'acceptedAt',
  'challengeDate',
  'nickname',
  'participantId',
  'token',
])

const retryResponse = await joinHandler(
  joinRequest(JSON.stringify({ nickname: 'Changed', joinRequestId: requestA })),
)
const retry = await retryResponse.json() as typeof first
assert.equal(retry.participantId, first.participantId)
assert.equal(retry.token, first.token)
assert.equal(retry.nickname, 'Same')
assert.equal(retry.acceptedAt, first.acceptedAt)

const otherResponse = await joinHandler(
  joinRequest(JSON.stringify({ nickname: 'Same', joinRequestId: requestB })),
)
const other = await otherResponse.json() as typeof first
assert.notEqual(other.participantId, first.participantId)
assert.notEqual(other.token, first.token)

for (const body of [
  JSON.stringify({ nickname: 'bad nickname', joinRequestId: randomUUID() }),
  JSON.stringify({ nickname: 'Valid', joinRequestId: 'bad' }),
  JSON.stringify({ nickname: 'Valid', joinRequestId: randomUUID(), extra: true }),
  '{bad json',
]) {
  const response = await joinHandler(joinRequest(body))
  assert.equal(response.status, 400)
  assert.equal(response.headers.get('cache-control'), 'no-store')
}
assert.equal(
  (await joinHandler(new Request(
    'https://example.test/api/daily/challenges/current/participants',
    { method: 'POST', body: '{}' },
  ))).status,
  400,
)
assert.equal(
  (await joinHandler(joinRequest('{}', { 'Content-Length': '513' }))).status,
  400,
)
assert.equal(
  (await joinHandler(joinRequest(JSON.stringify({
    nickname: 'A'.repeat(600),
    joinRequestId: randomUUID(),
  })))).status,
  400,
)
assert.equal(
  (await joinHandler(new Request(
    'https://example.test/api/daily/challenges/current/participants',
    { method: 'GET' },
  ))).status,
  405,
)

const record = {
  participantId: 'participant-1',
  challengeDate: date,
  displayNickname: 'Same',
  questionOrder: Array.from({ length: 20 }, (_, index) => index + 1),
  acceptedAt,
  completedAt: null,
  expiredAt: null,
}
const joined = await joinCurrentDailyChallenge(
  { nickname: 'Same', joinRequestId: requestA },
  async () => ({ ...record, token: tokenA }),
)
assert.equal(joined.nickname, 'Same')
assert.equal('questionOrder' in joined, false)

const participant = await getDailyParticipant(
  date,
  `Bearer ${tokenA}`,
  async (challengeDate, token) =>
    challengeDate === date && token === tokenA ? record : null,
)
assert.deepEqual(Object.keys(participant).sort(), [
  'acceptedAt',
  'challengeDate',
  'completedAt',
  'expiredAt',
  'nickname',
  'participantId',
])

const getHandler = createDailyParticipantHandler(async (challengeDate, authorization) =>
  getDailyParticipant(challengeDate, authorization, async (wantedDate, token) =>
    wantedDate === date && token === tokenA ? record : null,
  ))
const authenticated = await getHandler(new Request(
  `https://example.test/api/daily/challenges/${date}/participant`,
  { headers: { Authorization: `Bearer ${tokenA}` } },
))
assert.equal(authenticated.status, 200)
assert.equal(authenticated.headers.get('cache-control'), 'no-store')
assert.doesNotMatch(JSON.stringify(await authenticated.json()), /token|questionOrder|hash/i)

for (const [url, authorization, status] of [
  [`https://example.test/api/daily/challenges/${date}/participant`, 'Bearer bad', 401],
  [`https://example.test/api/daily/challenges/2026-10-15/participant`, `Bearer ${tokenA}`, 404],
  ['https://example.test/api/daily/challenges/bad/participant', `Bearer ${tokenA}`, 400],
] as const) {
  const response = await getHandler(new Request(url, {
    headers: { Authorization: authorization },
  }))
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

const secret = 'postgresql://secret:password@example.test/database'
const failedJoin = createDailyJoinHandler(async () => {
  throw new Error(secret)
})
const failedResponse = await failedJoin(
  joinRequest(JSON.stringify({ nickname: 'Valid', joinRequestId: randomUUID() })),
)
assert.equal(failedResponse.status, 500)
assert.doesNotMatch(await failedResponse.text(), /secret|password|postgresql/i)

const rewrittenJoin = await dailyApi.fetch(new Request(
  'https://example.test/api/daily?path=challenges/current/participants',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Valid', joinRequestId: randomUUID() }),
  },
))
assert.notEqual(rewrittenJoin.status, 404)
const notFound = await dailyApi.fetch(
  new Request('https://example.test/api/daily/unknown'),
)
assert.equal(notFound.status, 404)
assert.equal(notFound.headers.get('cache-control'), 'no-store')

assert.equal(records.size, 2)
assert.equal(JSON.stringify(first).includes(requestA), false)
assert.equal(JSON.stringify(first).includes('hash'), false)

console.log('verify:daily-participant-api OK')
