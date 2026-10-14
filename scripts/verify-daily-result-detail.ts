/**
 * DAILY personal RESULT detail (eng9D) — board join, auth, UI wiring (no real DB).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDailyResultHandler } from '../api/_daily/challenges/[date]/result.ts'
import {
  DailyResultApiError,
  readDailyResult,
  validateDailyResultAuth,
} from '../server/daily/resultApi.ts'
import {
  tryAssembleDailyResultDetailRounds,
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
import {
  revealDailyRoundOpens,
  tryBuildDailyResultDetailRounds,
  formatDailyRoundEndReason,
} from '../src/daily/dailyResultDetail.ts'
import { parseDailySelfResult } from '../src/daily/dailyRankingClient.ts'
import { en } from '../src/i18n/en.ts'
import { dailyResultViewModel } from '../src/daily/dailyResultPresentation.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2026-10-14'
const environment = {
  DUEL_TOKEN_HMAC_KEY: Buffer.alloc(32, 0x71).toString('base64url'),
}
const token = deriveDailyParticipantCapability(date, randomUUID(), environment)
const otherToken = deriveDailyParticipantCapability(
  '2026-10-15',
  randomUUID(),
  environment,
)
const authHash = hashDailyParticipantCapability(token)
const PARTICIPANT_A = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_B = '22222222-2222-4222-8222-222222222222'
const IDENTITY = Array.from({ length: 20 }, (_, i) => i + 1)
/** Participant B plays challenge rounds in reverse play order. */
const REVERSED = [...IDENTITY].reverse()

function round(
  roundNumber: number,
  endReason: DailyRoundResultInput['endReason'],
  overrides: Partial<DailyRoundResultInput> = {},
): DailyRoundResultInput {
  const defaults: Record<DailyRoundResultInput['endReason'], DailyRoundResultInput> = {
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
      capturedCoins: 1,
      openedBagCount: 2,
      coinBagHits: 1,
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
      openedBagCount: 0,
      coinBagHits: 0,
      elapsedSeconds: 60,
    },
  }
  return { ...defaults[endReason], ...overrides, roundNumber, endReason }
}

function finishedRounds(): DailyRoundResultInput[] {
  return Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, i) => {
    const n = i + 1
    if (n === 1) return round(n, 'cleared')
    if (n === 2) return round(n, 'cashed_out')
    if (n === 3) return round(n, 'bombed', { openedBagCount: 2, coinBagHits: 1 })
    return round(n, 'timed_out')
  })
}

function placement(roundNumber: number, bomb = 8, coins: [number, number, number] = [1, 2, 3]) {
  return {
    roundNumber,
    bagCount: 8 as const,
    bombBagNumber: bomb,
    coinBagNumbers: coins,
  }
}

function opensFor(
  rounds: readonly DailyRoundResultInput[],
  participantId: string,
  placements: readonly {
    roundNumber: number
    bombBagNumber: number
    coinBagNumbers: readonly [number, number, number]
  }[],
) {
  const opens: {
    participantId: string
    challengeDate: string
    roundNumber: number
    openOrder: number
    bagNumber: number
  }[] = []
  for (const r of rounds) {
    const place = placements.find((p) => p.roundNumber === r.roundNumber)!
    const coins = [...place.coinBagNumbers]
    const empty = [1, 2, 3, 4, 5, 6, 7, 8].find(
      (bag) => bag !== place.bombBagNumber && !coins.includes(bag),
    )!
    if (r.endReason === 'cleared') {
      for (let i = 0; i < 3; i += 1) {
        opens.push({
          participantId,
          challengeDate: date,
          roundNumber: r.roundNumber,
          openOrder: i + 1,
          bagNumber: coins[i]!,
        })
      }
    } else if (r.endReason === 'cashed_out') {
      opens.push(
        {
          participantId,
          challengeDate: date,
          roundNumber: r.roundNumber,
          openOrder: 1,
          bagNumber: coins[0]!,
        },
        {
          participantId,
          challengeDate: date,
          roundNumber: r.roundNumber,
          openOrder: 2,
          bagNumber: empty,
        },
      )
    } else if (r.endReason === 'bombed') {
      opens.push(
        {
          participantId,
          challengeDate: date,
          roundNumber: r.roundNumber,
          openOrder: 1,
          bagNumber: coins[0]!,
        },
        {
          participantId,
          challengeDate: date,
          roundNumber: r.roundNumber,
          openOrder: 2,
          bagNumber: place.bombBagNumber,
        },
      )
    }
  }
  return opens
}

function attempts(
  rounds: readonly DailyRoundResultInput[],
  participantId: string,
  questionOrder: readonly number[],
): DailyAttemptResultRow[] {
  return rounds.map((r) => ({
    participantId,
    challengeDate: date,
    roundNumber: r.roundNumber,
    challengeRoundNumber: questionOrder[r.roundNumber - 1]!,
    status: r.endReason,
    elapsedSeconds: r.elapsedSeconds,
    capturedCoins: r.capturedCoins,
    openedBagCount: r.openedBagCount,
    coinBagHits: r.coinBagHits,
  }))
}

function participant(
  participantId: string,
  questionOrder: readonly number[],
): DailyResultParticipantRow {
  return {
    participantId,
    challengeDate: date,
    displayNickname: 'DetailPlayer',
    acceptedAt: '2026-10-14T00:05:00.000Z',
    completedAt: '2026-10-14T12:00:00.000Z',
    expiredAt: null,
    questionOrder,
  }
}

function detailSource(
  participantId: string,
  questionOrder: readonly number[],
  rounds = finishedRounds(),
) {
  // Placements are in PLAY order; contents follow challenge round via questionOrder.
  const placements = rounds.map((r) => {
    const challengeRound = questionOrder[r.roundNumber - 1]!
    // Distinct bomb per challenge-round so order swaps are detectable.
    const bomb = ((challengeRound - 1) % 5) + 4
    const coins = [1, 2, 3].map((n) => (n === bomb ? 6 : n)) as [
      number,
      number,
      number,
    ]
    return placement(r.roundNumber, bomb, coins)
  })
  return {
    participant: participant(participantId, questionOrder),
    attempts: attempts(rounds, participantId, questionOrder),
    opens: opensFor(rounds, participantId, placements),
    placements,
  }
}

// --- Pure reveal ---
const revealed = revealDailyRoundOpens(placement(1), [
  { roundNumber: 1, openOrder: 1, bagNumber: 1 },
  { roundNumber: 1, openOrder: 2, bagNumber: 8 },
])
assert.equal(revealed[0]!.kind, 'coins')
assert.equal(revealed[0]!.coinCount, 1)
assert.equal(revealed[1]!.kind, 'bomb')

assert.equal(formatDailyRoundEndReason('timed_out', en), en.dailyTimeoutLabel)
assert.equal(formatDailyRoundEndReason('cleared', en), en.groupThreeCoinsComplete)
assert.equal(formatDailyRoundEndReason('bombed', en), en.groupRoundBombed)
assert.equal(formatDailyRoundEndReason('cashed_out', en), en.groupRoundCashedOut)

// --- Build detail with identity order ---
const srcA = detailSource(PARTICIPANT_A, IDENTITY)
const summaryA = tryBuildDailyParticipantResultSummary(
  srcA.participant,
  srcA.attempts,
)!
const detailA = tryAssembleDailyResultDetailRounds(
  srcA.participant,
  srcA.attempts,
  srcA.opens,
  srcA.placements,
  summaryA,
)!
assert.equal(detailA.length, 20)
assert.equal(detailA[0]!.endReason, 'cleared')
assert.equal(detailA[0]!.opens.length, 3)
assert.equal(detailA[0]!.opens[0]!.kind, 'coins')
assert.equal(detailA[1]!.endReason, 'cashed_out')
assert.equal(detailA[2]!.endReason, 'bombed')
assert.ok(detailA[2]!.opens.some((o) => o.kind === 'bomb'))
assert.equal(detailA[3]!.endReason, 'timed_out')
assert.equal(detailA[3]!.opens.length, 0)

// --- Two participants with different question orders must not swap boards ---
const srcB = detailSource(PARTICIPANT_B, REVERSED)
const summaryB = tryBuildDailyParticipantResultSummary(
  srcB.participant,
  srcB.attempts,
)!
const detailB = tryAssembleDailyResultDetailRounds(
  srcB.participant,
  srcB.attempts,
  srcB.opens,
  srcB.placements,
  summaryB,
)!
// Play ROUND 1 for A uses challenge round 1 → bomb 4
// Play ROUND 1 for B uses challenge round 20 → bomb ((20-1)%5)+4 = 8
assert.equal(detailA[0]!.bombBagNumber, 4)
assert.equal(detailB[0]!.bombBagNumber, 8)
assert.notEqual(detailA[0]!.bombBagNumber, detailB[0]!.bombBagNumber)

// Wrong challengeRoundNumber → null
assert.equal(
  tryBuildDailyResultDetailRounds({
    rounds: summaryA.rounds,
    placements: srcA.placements,
    opens: srcA.opens,
    attempts: srcA.attempts.map((a) => ({
      roundNumber: a.roundNumber,
      challengeRoundNumber: 99,
      openedBagCount: a.openedBagCount,
    })),
    questionOrder: IDENTITY,
  }),
  null,
)

// Missing opens for cleared → null
assert.equal(
  tryBuildDailyResultDetailRounds({
    rounds: summaryA.rounds,
    placements: srcA.placements,
    opens: [],
    attempts: srcA.attempts.map((a) => ({
      roundNumber: a.roundNumber,
      challengeRoundNumber: a.challengeRoundNumber!,
      openedBagCount: a.openedBagCount,
    })),
    questionOrder: IDENTITY,
  }),
  null,
)

// --- Handler: complete self 200 with boards; incomplete / foreign rejected ---
const loadA = async (input: {
  challengeDate: string
  authTokenHash: string
}) => {
  if (input.challengeDate !== date || input.authTokenHash !== authHash) return null
  return srcA
}

const result = await readDailyResult(
  { challengeDate: date, authTokenHash: authHash },
  { loadDetailSource: loadA },
)
assert.equal(result.rounds.length, 20)
assert.equal(result.rounds[0]!.bagCount, 8)
assert.equal(result.rounds[0]!.opens.length, 3)
assert.doesNotMatch(JSON.stringify(result), /3cb_dp1_|authToken|questionOrder/)

const parsed = parseDailySelfResult(result, date)
assert.equal(parsed.rounds.length, 20)
assert.equal(parsed.rounds[2]!.endReason, 'bombed')

const ok = await createDailyResultHandler(async (a) =>
  readDailyResult(a, { loadDetailSource: loadA }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: `Bearer ${token}` },
  }),
)
assert.equal(ok.status, 200)

await assert.rejects(
  () =>
    readDailyResult(
      { challengeDate: date, authTokenHash: authHash },
      {
        loadDetailSource: async () => ({
          ...srcA,
          participant: { ...srcA.participant, completedAt: null },
        }),
      },
    ),
  (e: unknown) => e instanceof DailyResultApiError && e.code === 'UNAVAILABLE',
)

const foreign = await createDailyResultHandler(async (a) =>
  readDailyResult(a, {
    loadDetailSource: async (input) =>
      input.authTokenHash === authHash ? srcA : null,
  }),
)(
  new Request(`https://example.test/api/daily/challenges/${date}/result`, {
    headers: { authorization: `Bearer ${otherToken}` },
  }),
)
assert.equal(foreign.status, 404)

assert.throws(
  () => validateDailyResultAuth('bad', `Bearer ${token}`),
  (e: unknown) =>
    e instanceof DailyResultApiError && e.code === 'INVALID_REQUEST',
)

// Pending ranking still exposes self detail button path (view model + screen)
const pendingVm = dailyResultViewModel({
  kind: 'ranking_pending',
  self: parsed,
})
assert.equal(pendingVm.showSelfScores, true)
assert.equal(pendingVm.rows[0]!.isSelf, true)

// --- Source wiring ---
const resultApi = readFileSync(resolve(root, 'server/daily/resultApi.ts'), 'utf8')
assert.match(resultApi, /loadDailyResultDetailSource|loadDetailSource/)
assert.match(resultApi, /bagCount/)
assert.match(resultApi, /coinBagNumbers/)
assert.doesNotMatch(resultApi, /console\.(log|info|debug).*token/i)

const db = readFileSync(resolve(root, 'server/db/dailyResult.ts'), 'utf8')
assert.match(db, /getDailyPlacementsForParticipant/)
assert.match(db, /question_order/)
assert.match(db, /daily_challenge_round_opens/)
assert.match(db, /challenge_round_number/)
assert.doesNotMatch(db, /\b(?:DELETE|TRUNCATE|DROP)\b/i)

const screen = readFileSync(
  resolve(root, 'src/components/DailyResultScreen.tsx'),
  'utf8',
)
assert.match(screen, /DailyResultDetailScreen/)
assert.match(screen, /groupViewDetails/)
assert.match(screen, /onOpenSelfDetails/)
assert.match(screen, /ranking_pending/)

const detailUi = readFileSync(
  resolve(root, 'src/components/DailyResultDetailScreen.tsx'),
  'utf8',
)
assert.match(detailUi, /DuelMatchDetailBoard/)
assert.match(detailUi, /formatDailyRoundEndReason/)
assert.doesNotMatch(detailUi, /totalTimeSeconds/)

const groupDetail = readFileSync(
  resolve(root, 'src/components/GroupResultDetailScreen.tsx'),
  'utf8',
)
assert.match(groupDetail, /DuelMatchDetailBoard/)
assert.match(groupDetail, /groupViewDetails|onBackToResult/)

assert.match(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
  /verify:daily-result-detail/,
)

assert.match(
  readFileSync(resolve(root, 'src/daily/dailyResultDetail.ts'), 'utf8'),
  /questionOrder/,
)

console.log('verify:daily-result-detail OK')
