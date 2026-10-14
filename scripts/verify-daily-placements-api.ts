/**
 * DAILY placements GET API: source guards, handler mocks, optional Neon remapping.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDailyPlacementsHandler } from '../api/_daily/challenges/[date]/placements.ts'
import {
  DailyPlayApiError,
  readDailyPlacements,
  toDailyPlacementsResponse,
  validateDailyPlayAuth,
} from '../server/daily/placementsApi.ts'
import type { PersistedDailyPlacementSet } from '../server/db/dailyPlacements.ts'
import {
  DAILY_CHALLENGE_ROUNDS,
  DAILY_FORMATION_VERSION,
  DAILY_RULE_VERSION,
} from '../src/daily/dailyQuestionSet.ts'
import {
  deriveDailyParticipantCapability,
  hashDailyParticipantCapability,
} from '../server/auth/dailyTokens.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2099-11-01'
const otherDate = '2099-11-02'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const joinRequestId = randomUUID()
const token = deriveDailyParticipantCapability(date, joinRequestId, environment)
const otherToken = deriveDailyParticipantCapability(
  otherDate,
  randomUUID(),
  environment,
)

const safeSet: PersistedDailyPlacementSet = {
  challengeDate: date,
  formationVersion: DAILY_FORMATION_VERSION,
  ruleVersion: DAILY_RULE_VERSION,
  placements: Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, index) => ({
    roundNumber: index + 1,
    bagCount: 5 as const,
    bombBagNumber: 5,
    coinBagNumbers: [1, 2, 3] as [number, number, number],
  })),
}

const dto = toDailyPlacementsResponse(safeSet)
assert.deepEqual(Object.keys(dto).sort(), [
  'challengeDate',
  'formationVersion',
  'placements',
  'ruleVersion',
].sort())
assert.equal(dto.placements.length, 20)
assert.equal(dto.formationVersion, 1)
assert.equal(dto.ruleVersion, 1)
assert.doesNotMatch(JSON.stringify(dto), /question_order|questionOrder|token|participantId|auth/i)
for (let index = 0; index < 20; index += 1) {
  assert.equal(dto.placements[index]!.roundNumber, index + 1)
  assert.deepEqual(Object.keys(dto.placements[index]!).sort(), [
    'bagCount',
    'bombBagNumber',
    'coinBagNumbers',
    'roundNumber',
  ].sort())
}

assert.throws(
  () => validateDailyPlayAuth('bad', `Bearer ${token}`),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'INVALID_REQUEST',
)
assert.throws(
  () => validateDailyPlayAuth(date, null),
  (error: unknown) =>
    error instanceof DailyPlayApiError && error.code === 'UNAUTHORIZED',
)

const handler = createDailyPlacementsHandler(async () =>
  toDailyPlacementsResponse(safeSet),
)
const ok = await handler(
  new Request(`https://example.test/api/daily/challenges/${date}/placements`, {
    headers: { Authorization: `Bearer ${token}` },
  }),
)
assert.equal(ok.status, 200)
assert.equal(ok.headers.get('cache-control'), 'no-store')
const body = (await ok.json()) as { placements: unknown[] }
assert.equal(body.placements.length, 20)

const method = await handler(
  new Request(`https://example.test/api/daily/challenges/${date}/placements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }),
)
assert.equal(method.status, 405)

const unauthorized = await handler(
  new Request(`https://example.test/api/daily/challenges/${date}/placements`),
)
assert.equal(unauthorized.status, 401)

const missing = createDailyPlacementsHandler(async () => {
  throw new DailyPlayApiError('NOT_FOUND')
})
const notFound = await missing(
  new Request(`https://example.test/api/daily/challenges/${date}/placements`, {
    headers: { Authorization: `Bearer ${token}` },
  }),
)
assert.equal(notFound.status, 404)

const playSource = readFileSync(resolve(root, 'server/daily/playApi.ts'), 'utf8')
assert.match(playSource, /Safe play DTO/)
assert.doesNotMatch(
  playSource,
  /bombBagNumber|coinBagNumbers/,
  'GET play must stay placement-free',
)
const openSource = readFileSync(resolve(root, 'server/daily/openBag.ts'), 'utf8')
assert.doesNotMatch(openSource, /bombBagNumber|coinBagNumbers/)
const placementsApi = readFileSync(
  resolve(root, 'server/daily/placementsApi.ts'),
  'utf8',
)
assert.match(placementsApi, /readDailyPlacements/)
assert.match(placementsApi, /toDailyPlacementsResponse/)
assert.doesNotMatch(placementsApi, /console\./)
const dbSource = readFileSync(resolve(root, 'server/db/dailyPlacements.ts'), 'utf8')
assert.match(dbSource, /unnest\(participant\.question_order\)/)
assert.match(dbSource, /with ordinality/)
assert.doesNotMatch(dbSource, /console\./)
const router = readFileSync(resolve(root, 'api/daily.ts'), 'utf8')
assert.match(router, /placements/)

assert.equal(
  await readDailyPlacements(
    { challengeDate: date, authTokenHash: 'x' },
    {
      getPlacements: async () => safeSet,
    },
  ).then((value) => value.placements.length),
  20,
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
  console.log('verify:daily-placements-api OK (handlers; Neon skipped)')
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
const { getDailyPlacementsForParticipant } = await import(
  '../server/db/dailyPlacements.ts'
)
const { createDailyPlacementsHandler: livePlacements } = await import(
  '../api/_daily/challenges/[date]/placements.ts'
)

const liveDate = '2099-11-10'
const joinA = randomUUID()
const joinB = randomUUID()
const tokenA = deriveDailyParticipantCapability(liveDate, joinA, environment)
const tokenB = deriveDailyParticipantCapability(liveDate, joinB, environment)
const hashA = hashDailyParticipantCapability(tokenA)
const hashB = hashDailyParticipantCapability(tokenB)
const identityOrder = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => index + 1).join(',')}]::smallint[]`,
)
const reverseOrder = sql.raw(
  `array[${Array.from({ length: 20 }, (_, index) => 20 - index).join(',')}]::smallint[]`,
)

async function cleanup() {
  await getDatabase().execute(sql`
    delete from daily_challenges where challenge_date = ${liveDate}::date
  `)
}

await cleanup()
const questionSet = await persistOrLoadDailyQuestionSet({
  challengeDate: liveDate,
  rounds: provideDailyQuestionRounds(),
})
assert.equal(questionSet.rounds.length, 20)

await getDatabase().execute(sql`
  insert into daily_challenge_participants (
    challenge_date, display_nickname, nickname_key, auth_token_hash,
    join_request_id, question_order
  ) values
  (
    ${liveDate}::date, 'PlaceA', 'placea', ${hashA},
    ${joinA}::uuid, ${identityOrder}
  ),
  (
    ${liveDate}::date, 'PlaceB', 'placeb', ${hashB},
    ${joinB}::uuid, ${reverseOrder}
  )
`)

// START not required — JOIN alone can fetch placements.
const firstA = await getDailyPlacementsForParticipant({
  challengeDate: liveDate,
  authTokenHash: hashA,
})
assert.ok(firstA)
assert.equal(firstA!.placements.length, 20)
for (let index = 0; index < 20; index += 1) {
  const play = firstA!.placements[index]!
  const challenge = questionSet.rounds[index]!
  assert.equal(play.roundNumber, index + 1)
  assert.equal(play.bagCount, challenge.bagCount)
  assert.equal(play.bombBagNumber, challenge.bombBagNumber)
  assert.deepEqual([...play.coinBagNumbers], [...challenge.coinBagNumbers])
}

const secondA = await getDailyPlacementsForParticipant({
  challengeDate: liveDate,
  authTokenHash: hashA,
})
assert.deepEqual(secondA, firstA)

const firstB = await getDailyPlacementsForParticipant({
  challengeDate: liveDate,
  authTokenHash: hashB,
})
assert.ok(firstB)
assert.equal(firstB!.placements.length, 20)
for (let index = 0; index < 20; index += 1) {
  const play = firstB!.placements[index]!
  const challenge = questionSet.rounds[19 - index]!
  assert.equal(play.roundNumber, index + 1)
  assert.equal(play.bagCount, challenge.bagCount)
  assert.equal(play.bombBagNumber, challenge.bombBagNumber)
  assert.deepEqual([...play.coinBagNumbers], [...challenge.coinBagNumbers])
}

// Same underlying 20-question multiset (challenge-round identity), different play order.
assert.notDeepEqual(
  firstA!.placements.map((p) => p.bombBagNumber),
  firstB!.placements.map((p) => p.bombBagNumber),
)
const keysA = new Set(
  firstA!.placements.map(
    (p) => `${p.bagCount}|${p.bombBagNumber}|${p.coinBagNumbers.join(',')}`,
  ),
)
const keysB = new Set(
  firstB!.placements.map(
    (p) => `${p.bagCount}|${p.bombBagNumber}|${p.coinBagNumbers.join(',')}`,
  ),
)
assert.deepEqual([...keysA].sort(), [...keysB].sort())

const live = livePlacements()
const httpA = await live(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/placements`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  ),
)
assert.equal(httpA.status, 200)
const httpBody = (await httpA.json()) as {
  challengeDate: string
  placements: { roundNumber: number }[]
}
assert.equal(httpBody.challengeDate, liveDate)
assert.equal(httpBody.placements.length, 20)
assert.doesNotMatch(JSON.stringify(httpBody), /question_order|questionOrder/)

const wrongBearer = await live(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/placements`,
    { headers: { Authorization: `Bearer ${otherToken}` } },
  ),
)
assert.equal(wrongBearer.status, 404)

const missingParticipant = await getDailyPlacementsForParticipant({
  challengeDate: liveDate,
  authTokenHash: hashDailyParticipantCapability(
    deriveDailyParticipantCapability(liveDate, randomUUID(), environment),
  ),
})
assert.equal(missingParticipant, null)

const routed = await (
  await import('../api/daily.ts')
).default.fetch(
  new Request(
    `https://example.test/api/daily/challenges/${liveDate}/placements`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  ),
)
assert.equal(routed.status, 200)

await cleanup()
console.log('verify:daily-placements-api OK (handlers+Neon dev)')
