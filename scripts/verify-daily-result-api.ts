/**
 * DAILY RESULT API — handler + auth + DB-loader wiring (no real DB).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDailyResultHandler } from '../api/_daily/challenges/[date]/result.ts'
import {
  DailyResultApiError,
  readDailyResult,
  toDailyResultResponse,
  validateDailyResultAuth,
} from '../server/daily/resultApi.ts'
import {
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultParticipantRow,
} from '../server/db/dailyResult.ts'
import {
  deriveDailyParticipantCapability,
  hashDailyParticipantCapability,
} from '../server/auth/dailyTokens.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import type { DailyRoundResultInput } from '../src/daily/dailyResult.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2026-10-14'
const pastDate = '2026-10-13'
const otherDate = '2026-10-15'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const joinRequestId = randomUUID()
const token = deriveDailyParticipantCapability(date, joinRequestId, environment)
const pastToken = deriveDailyParticipantCapability(
  pastDate,
  randomUUID(),
  environment,
)
const otherToken = deriveDailyParticipantCapability(
  otherDate,
  randomUUID(),
  environment,
)
const authHash = hashDailyParticipantCapability(token)
const pastHash = hashDailyParticipantCapability(pastToken)
const PARTICIPANT_A = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_B = '22222222-2222-4222-8222-222222222222'
const ACCEPTED = '2026-10-14T10:00:00.000Z'
const COMPLETED = '2026-10-14T12:30:00.000Z'

function round(
  roundNumber: number,
  endReason: DailyRoundResultInput['endReason'],
  overrides: Partial<DailyRoundResultInput> = {},
): DailyRoundResultInput {
  const defaults: Record<
    DailyRoundResultInput['endReason'],
    DailyRoundResultInput
  > = {
    cleared: {
      roundNumber,
      endReason: 'cleared',
      capturedCoins: 3,
      openedBagCount: 3,
      coinBagHits: 3,
      elapsedSeconds: 20,
    },
    cashed_out: {
      roundNumber,
      endReason: 'cashed_out',
      capturedCoins: 2,
      openedBagCount: 2,
      coinBagHits: 2,
      elapsedSeconds: 15,
    },
    bombed: {
      roundNumber,
      endReason: 'bombed',
      capturedCoins: 0,
      openedBagCount: 2,
      coinBagHits: 1,
      elapsedSeconds: 10,
    },
    timed_out: {
      roundNumber,
      endReason: 'timed_out',
      capturedCoins: 0,
      openedBagCount: 1,
      coinBagHits: 1,
      elapsedSeconds: 60,
    },
  }
  return { ...defaults[endReason], ...overrides, roundNumber, endReason }
}

function twenty(
  factory: (n: number) => DailyRoundResultInput,
): DailyRoundResultInput[] {
  return Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, i) => factory(i + 1))
}

function finishedRounds(): DailyRoundResultInput[] {
  return twenty((n) =>
    n <= 4
      ? round(n, 'cleared', { elapsedSeconds: 12 })
      : n <= 8
        ? round(n, 'cashed_out', {
            capturedCoins: 1,
            openedBagCount: 2,
            coinBagHits: 1,
            elapsedSeconds: 25,
          })
        : n <= 12
          ? round(n, 'bombed', {
              openedBagCount: 3,
              coinBagHits: 2,
              elapsedSeconds: 9,
            })
          : round(n, 'timed_out', {
              openedBagCount: 0,
              coinBagHits: 0,
              elapsedSeconds: 60,
            }),
  )
}

const IDENTITY_ORDER = Array.from(
  { length: DAILY_CHALLENGE_ROUNDS },
  (_, i) => i + 1,
)

function attemptsFromRounds(
  rounds: readonly DailyRoundResultInput[],
  participantId = PARTICIPANT_A,
  challengeDate = date,
  questionOrder: readonly number[] = IDENTITY_ORDER,
): DailyAttemptResultRow[] {
  return rounds.map((r) => ({
    participantId,
    challengeDate,
    roundNumber: r.roundNumber,
    challengeRoundNumber: questionOrder[r.roundNumber - 1]!,
    status: r.endReason,
    elapsedSeconds: r.elapsedSeconds,
    capturedCoins: r.capturedCoins,
    openedBagCount: r.openedBagCount,
    coinBagHits: r.coinBagHits,
  }))
}

function placementsForRounds(rounds: readonly DailyRoundResultInput[]) {
  return rounds.map((r) => ({
    roundNumber: r.roundNumber,
    bagCount: 8 as const,
    bombBagNumber: 8,
    coinBagNumbers: [1, 2, 3] as [number, number, number],
  }))
}

function opensForRounds(
  rounds: readonly DailyRoundResultInput[],
  participantId = PARTICIPANT_A,
  challengeDate = date,
) {
  const opens: {
    participantId: string
    challengeDate: string
    roundNumber: number
    openOrder: number
    bagNumber: number
  }[] = []
  for (const r of rounds) {
    if (r.endReason === 'cleared') {
      for (let i = 0; i < 3; i += 1) {
        opens.push({
          participantId,
          challengeDate,
          roundNumber: r.roundNumber,
          openOrder: i + 1,
          bagNumber: i + 1,
        })
      }
    } else if (r.endReason === 'cashed_out') {
      opens.push(
        {
          participantId,
          challengeDate,
          roundNumber: r.roundNumber,
          openOrder: 1,
          bagNumber: 1,
        },
        {
          participantId,
          challengeDate,
          roundNumber: r.roundNumber,
          openOrder: 2,
          bagNumber: 4,
        },
      )
    } else if (r.endReason === 'bombed') {
      const count = r.openedBagCount
      for (let i = 0; i < count - 1; i += 1) {
        opens.push({
          participantId,
          challengeDate,
          roundNumber: r.roundNumber,
          openOrder: i + 1,
          bagNumber: i + 1,
        })
      }
      opens.push({
        participantId,
        challengeDate,
        roundNumber: r.roundNumber,
        openOrder: count,
        bagNumber: 8,
      })
    }
  }
  return opens
}

function participantRow(
  overrides: Partial<DailyResultParticipantRow> = {},
): DailyResultParticipantRow {
  return {
    participantId: PARTICIPANT_A,
    challengeDate: date,
    displayNickname: 'ResultPlayer',
    acceptedAt: ACCEPTED,
    completedAt: COMPLETED,
    expiredAt: null,
    questionOrder: IDENTITY_ORDER,
    ...overrides,
  }
}

function detailSource(
  rounds: readonly DailyRoundResultInput[],
  overrides: Partial<DailyResultParticipantRow> = {},
  questionOrder: readonly number[] = IDENTITY_ORDER,
) {
  const participant = participantRow({
    questionOrder,
    ...overrides,
  })
  return {
    participant,
    attempts: attemptsFromRounds(
      rounds,
      participant.participantId,
      participant.challengeDate,
      questionOrder,
    ),
    opens: opensForRounds(
      rounds,
      participant.participantId,
      participant.challengeDate,
    ),
    placements: placementsForRounds(rounds),
  }
}

function bearer(value: string): string {
  return `Bearer ${value}`
}

// --- Auth validation ---
assert.throws(
  () => validateDailyResultAuth('bad-date', bearer(token)),
  (e: unknown) =>
    e instanceof DailyResultApiError && e.code === 'INVALID_REQUEST',
)
assert.throws(
  () => validateDailyResultAuth(date, null),
  (e: unknown) => e instanceof DailyResultApiError && e.code === 'UNAUTHORIZED',
)
assert.throws(
  () => validateDailyResultAuth(date, 'Bearer not-a-token'),
  (e: unknown) => e instanceof DailyResultApiError && e.code === 'UNAUTHORIZED',
)
const auth = validateDailyResultAuth(date, bearer(token))
assert.equal(auth.challengeDate, date)
assert.equal(auth.authTokenHash, authHash)
assert.doesNotMatch(JSON.stringify(auth), /3cb_dp1_/)

// --- Happy path through readDailyResult + handler ---
const rounds = finishedRounds()
const expectedCoins = 12 + 4
const expectedComplete = 4
const expectedHits = 12 + 4 + 8
const expectedOpens = 12 + 8 + 12
const expectedTime = 48 + 100 + 36 + 480

async function loadFinished(input: {
  readonly challengeDate: string
  readonly authTokenHash: string
}) {
  if (input.challengeDate !== date || input.authTokenHash !== authHash) {
    return null
  }
  return detailSource(rounds)
}

const result = await readDailyResult(
  { challengeDate: date, authTokenHash: authHash },
  { loadDetailSource: loadFinished },
)
assert.equal(result.challengeDate, date)
assert.equal(result.participantId, PARTICIPANT_A)
assert.equal(result.nickname, 'ResultPlayer')
assert.equal(result.completedAt, COMPLETED)
assert.equal(result.totalCoins, expectedCoins)
assert.equal(result.threeCoinsComplete, expectedComplete)
assert.equal(result.coinBagHits, expectedHits)
assert.equal(result.totalOpens, expectedOpens)
assert.deepEqual(result.coinBagHitRate, {
  numerator: expectedHits,
  denominator: expectedOpens,
})
assert.equal(result.totalTimeSeconds, expectedTime)
assert.equal(result.rounds.length, 20)
assert.equal(result.rounds[0]!.roundNumber, 1)
assert.equal(result.rounds[19]!.roundNumber, 20)
assert.equal(result.rounds[0]!.endReason, 'cleared')
assert.equal(result.rounds[19]!.endReason, 'timed_out')

const body = JSON.stringify(result)
assert.doesNotMatch(
  body,
  /token|authToken|auth_token|3cb_dp1_|questionOrder|auth_token_hash/i,
)
assert.match(body, /ResultPlayer/)
assert.match(body, /bombBagNumber/)
assert.match(body, /coinBagNumbers/)
assert.equal(result.rounds[0]!.bagCount, 8)
assert.equal(result.rounds[0]!.opens.length, 3)
assert.equal(result.rounds[0]!.opens[0]!.kind, 'coins')
assert.equal(result.rounds[19]!.opens.length, 0)

const handler = createDailyResultHandler(async (a) =>
  readDailyResult(a, { loadDetailSource: loadFinished }),
)
const okResponse = await handler(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(okResponse.status, 200)
assert.equal(okResponse.headers.get('Cache-Control'), 'no-store')
const okJson = (await okResponse.json()) as typeof result
assert.equal(okJson.totalCoins, expectedCoins)
assert.equal(okJson.rounds.length, 20)

// Router wiring is asserted via source (avoid default handler → real DB).
assert.match(
  readFileSync(resolve(root, 'api/daily.ts'), 'utf8'),
  /challenges\/\[date\]\/result/,
)
assert.match(
  readFileSync(resolve(root, 'api/daily.ts'), 'utf8'),
  /\/result\$/,
)

// --- Incomplete / in-progress / expired ---
async function expectUnavailable(
  loadDetailSource: typeof loadFinished,
  label: string,
): Promise<void> {
  await assert.rejects(
    () =>
      readDailyResult(
        { challengeDate: date, authTokenHash: authHash },
        { loadDetailSource },
      ),
    (e: unknown) =>
      e instanceof DailyResultApiError && e.code === 'UNAVAILABLE',
    label,
  )
  const response = await createDailyResultHandler(async (a) =>
    readDailyResult(a, { loadDetailSource }),
  )(
    new Request(`https://example.test/api/daily/challenges/${date}/result`, {
      headers: { authorization: bearer(token) },
    }),
  )
  assert.equal(response.status, 404, label)
  assert.deepEqual(await response.json(), {
    error: { code: 'result_unavailable' },
  })
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
}

await expectUnavailable(async () => null, 'missing participant')
await expectUnavailable(
  async () =>
    detailSource(rounds, { completedAt: null }),
  'not completed',
)
await expectUnavailable(
  async () =>
    detailSource(rounds.slice(0, 5), {
      completedAt: null,
      expiredAt: '2026-10-15T00:00:00.000Z',
    }),
  'expired incomplete',
)
await expectUnavailable(
  async () => detailSource(rounds.slice(0, 19)),
  '19 rounds',
)
await expectUnavailable(
  async () => ({
    participant: participantRow({ completedAt: null }),
    attempts: [
      {
        participantId: PARTICIPANT_A,
        challengeDate: date,
        roundNumber: 1,
        challengeRoundNumber: 1,
        status: 'active',
        elapsedSeconds: null,
        capturedCoins: null,
        openedBagCount: 0,
        coinBagHits: null,
      },
    ],
    opens: [],
    placements: placementsForRounds(rounds.slice(0, 1)),
  }),
  'in progress',
)

// Duplicate / missing round numbers among 20 rows
const dupSource = detailSource(rounds)
const dupAttempts = [...dupSource.attempts]
dupAttempts[19] = { ...dupAttempts[19]!, roundNumber: 1, status: 'cleared' }
await expectUnavailable(
  async () => ({ ...dupSource, attempts: dupAttempts }),
  'duplicate round',
)

// Wrong participant id on attempt rows
await expectUnavailable(
  async () => ({
    ...detailSource(rounds),
    attempts: attemptsFromRounds(rounds, PARTICIPANT_B),
  }),
  'attempt participant mismatch',
)

// --- Other participant token / date mismatch ---
await assert.rejects(
  () =>
    readDailyResult(
      { challengeDate: date, authTokenHash: pastHash },
      {
        loadDetailSource: async (input) =>
          input.authTokenHash === authHash ? detailSource(rounds) : null,
      },
    ),
  (e: unknown) => e instanceof DailyResultApiError && e.code === 'UNAVAILABLE',
)

const foreign = await createDailyResultHandler(async (a) =>
  readDailyResult(a, {
    loadDetailSource: async (input) =>
      input.authTokenHash === authHash ? detailSource(rounds) : null,
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: bearer(otherToken) },
  }),
)
assert.equal(foreign.status, 404)

const badAuth = await createDailyResultHandler()(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: 'Bearer totally-invalid' },
  }),
)
assert.equal(badAuth.status, 401)
assert.deepEqual(await badAuth.json(), { error: { code: 'unauthorized' } })

// Same nickname, different participants stay separate
const twinRounds = finishedRounds()
const twinSourceA = detailSource(twinRounds, {
  participantId: PARTICIPANT_A,
  displayNickname: 'Twin',
})
const twinSourceB = detailSource(twinRounds, {
  participantId: PARTICIPANT_B,
  displayNickname: 'Twin',
})
const twinA = tryBuildDailyParticipantResultSummary(
  twinSourceA.participant,
  twinSourceA.attempts,
)!
const twinB = tryBuildDailyParticipantResultSummary(
  twinSourceB.participant,
  twinSourceB.attempts,
)!
assert.equal(twinA.displayNickname, twinB.displayNickname)
assert.notEqual(twinA.participantId, twinB.participantId)
const { tryAssembleDailyResultDetailRounds } = await import(
  '../server/db/dailyResult.ts'
)
const twinDetailA = tryAssembleDailyResultDetailRounds(
  twinSourceA.participant,
  twinSourceA.attempts,
  twinSourceA.opens,
  twinSourceA.placements,
  twinA,
)!
const twinDetailB = tryAssembleDailyResultDetailRounds(
  twinSourceB.participant,
  twinSourceB.attempts,
  twinSourceB.opens,
  twinSourceB.placements,
  twinB,
)!
const responseA = toDailyResultResponse(twinA, COMPLETED, twinDetailA)
const responseB = toDailyResultResponse(twinB, COMPLETED, twinDetailB)
assert.notEqual(responseA.participantId, responseB.participantId)

// Past-day RESULT via date in path + matching capability
const pastRounds = finishedRounds()
const pastResult = await readDailyResult(
  { challengeDate: pastDate, authTokenHash: pastHash },
  {
    loadDetailSource: async (input) => {
      if (input.challengeDate !== pastDate || input.authTokenHash !== pastHash) {
        return null
      }
      return detailSource(pastRounds, {
        challengeDate: pastDate,
        acceptedAt: '2026-10-13T10:00:00.000Z',
        completedAt: '2026-10-13T18:00:00.000Z',
      })
    },
  },
)
assert.equal(pastResult.challengeDate, pastDate)
assert.equal(pastResult.completedAt, '2026-10-13T18:00:00.000Z')
assert.equal(pastResult.rounds[0]!.bombBagNumber, 8)

const pastHandler = await createDailyResultHandler(async (a) =>
  readDailyResult(a, {
    loadDetailSource: async (input) => {
      if (input.challengeDate !== pastDate || input.authTokenHash !== pastHash) {
        return null
      }
      return detailSource(pastRounds, {
        challengeDate: pastDate,
        completedAt: '2026-10-13T18:00:00.000Z',
        acceptedAt: '2026-10-13T10:00:00.000Z',
      })
    },
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${pastDate}/result`, {
    headers: { authorization: bearer(pastToken) },
  }),
)
assert.equal(pastHandler.status, 200)
assert.equal(((await pastHandler.json()) as { challengeDate: string }).challengeDate, pastDate)

// Method not allowed
const post = await createDailyResultHandler()(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    method: 'POST',
    headers: { authorization: bearer(token) },
  }),
)
assert.equal(post.status, 405)

// Source safety: no token logging helpers dumping capability
const resultApiSource = readFileSync(
  resolve(root, 'server/daily/resultApi.ts'),
  'utf8',
)
assert.match(resultApiSource, /hashDailyParticipantCapability/)
assert.match(resultApiSource, /tryBuildDailyParticipantResultSummary|buildSummary/)
assert.doesNotMatch(resultApiSource, /console\.(log|info|debug).*token/i)

const handlerSource = readFileSync(
  resolve(root, 'api/_daily/challenges/[date]/result.ts'),
  'utf8',
)
assert.match(handlerSource, /Cache-Control.*no-store|no-store/)
assert.match(handlerSource, /result_unavailable/)

const dailyRouter = readFileSync(resolve(root, 'api/daily.ts'), 'utf8')
assert.match(dailyRouter, /\/result\$/)

const dbSource = readFileSync(resolve(root, 'server/db/dailyResult.ts'), 'utf8')
assert.match(dbSource, /loadDailyResultSource/)
assert.match(dbSource, /auth_token_hash/)
assert.doesNotMatch(dbSource, /\b(?:DELETE|TRUNCATE|DROP)\b/i)

console.log('verify:daily-result-api OK')
