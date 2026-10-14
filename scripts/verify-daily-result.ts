/**
 * DAILY RESULT aggregation — DB-free unit checks (engineering 7).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DailyResultValidationError,
  aggregateDailyParticipantResult,
  compareDailyCoinBagHitRate,
  compareDailyParticipantScores,
  isCompleteDailyTerminalRoundSet,
  tryAggregateDailyParticipantResult,
  type DailyRoundResultInput,
} from '../src/daily/dailyResult.ts'
import {
  buildDailyParticipantResultSummary,
  dailyAttemptRowToRoundInput,
  tryBuildDailyParticipantResultSummary,
  type DailyAttemptResultRow,
  type DailyResultParticipantRow,
} from '../server/db/dailyResult.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'

const root = resolve(import.meta.dirname, '..')
const PARTICIPANT_A = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_B = '22222222-2222-4222-8222-222222222222'
const ACCEPTED = '2099-08-01T12:00:00.000Z'
const DATE = '2099-08-01'

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
  factory: (roundNumber: number) => DailyRoundResultInput,
): DailyRoundResultInput[] {
  return Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, index) =>
    factory(index + 1),
  )
}

function input(
  rounds: readonly DailyRoundResultInput[],
  participantId = PARTICIPANT_A,
  nickname = 'Tester',
) {
  return {
    participantId,
    displayNickname: nickname,
    challengeDate: DATE,
    acceptedAt: ACCEPTED,
    rounds,
  }
}

function attemptFromRound(
  r: DailyRoundResultInput,
  participantId = PARTICIPANT_A,
): DailyAttemptResultRow {
  return {
    participantId,
    challengeDate: DATE,
    roundNumber: r.roundNumber,
    status: r.endReason,
    elapsedSeconds: r.elapsedSeconds,
    capturedCoins: r.capturedCoins,
    openedBagCount: r.openedBagCount,
    coinBagHits: r.coinBagHits,
  }
}

function participant(
  overrides: Partial<DailyResultParticipantRow> = {},
): DailyResultParticipantRow {
  return {
    participantId: PARTICIPANT_A,
    challengeDate: DATE,
    displayNickname: 'Tester',
    acceptedAt: ACCEPTED,
    completedAt: '2099-08-01T13:00:00.000Z',
    expiredAt: null,
    ...overrides,
  }
}

// --- Complete 20-ROUND happy path ---
{
  const rounds = twenty((n) =>
    n <= 5
      ? round(n, 'cleared', {
          openedBagCount: 4,
          coinBagHits: 3,
          elapsedSeconds: 12,
        })
      : n <= 10
        ? round(n, 'cashed_out', {
            capturedCoins: 1,
            openedBagCount: 2,
            coinBagHits: 1,
            elapsedSeconds: 30,
          })
        : n <= 15
          ? round(n, 'bombed', {
              openedBagCount: 3,
              coinBagHits: 2,
              elapsedSeconds: 8,
            })
          : round(n, 'timed_out', {
              openedBagCount: 0,
              coinBagHits: 0,
              elapsedSeconds: 60,
            }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.totalCoins, 15 + 5)
  assert.equal(summary.threeCoinsComplete, 5)
  assert.equal(summary.coinBagHits, 15 + 5 + 10)
  assert.equal(summary.totalOpens, 20 + 10 + 15)
  assert.equal(summary.totalTimeSeconds, 60 + 150 + 40 + 300)
  assert.deepEqual(summary.coinBagHitRate, {
    numerator: summary.coinBagHits,
    denominator: summary.totalOpens,
  })
  assert.equal(summary.rounds.length, 20)
  assert.equal(isCompleteDailyTerminalRoundSet(rounds), true)
}

// --- TOTAL COINS sum ---
{
  const rounds = twenty((n) =>
    round(n, 'cashed_out', { capturedCoins: n % 2 === 0 ? 2 : 1 }),
  )
  assert.equal(aggregateDailyParticipantResult(input(rounds)).totalCoins, 30)
}

// --- 3COINS COMPLETE only cleared ---
{
  const rounds = twenty((n) => {
    if (n <= 3) return round(n, 'cleared')
    if (n === 4) return round(n, 'cashed_out', { capturedCoins: 2 })
    if (n === 5) return round(n, 'bombed')
    return round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 })
  })
  assert.equal(aggregateDailyParticipantResult(input(rounds)).threeCoinsComplete, 3)
}

// --- COMPLETE across multiple bags (openedBagCount > coinBagHits ok; cleared) ---
{
  const rounds = twenty((n) =>
    n === 1
      ? round(1, 'cleared', {
          openedBagCount: 5,
          coinBagHits: 3,
          capturedCoins: 3,
        })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.threeCoinsComplete, 1)
  assert.equal(summary.rounds[0]!.coinBagHits, 3)
  assert.equal(summary.rounds[0]!.openedBagCount, 5)
}

// --- One bag with multiple coins still one HIT ---
{
  const rounds = twenty((n) =>
    n === 1
      ? round(1, 'cleared', {
          openedBagCount: 2,
          coinBagHits: 2,
          capturedCoins: 3,
        })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.coinBagHits, 2)
  assert.equal(summary.totalCoins, 3)
}

// --- BOMB: 0 coins, hits from prior opens retained ---
{
  const rounds = twenty((n) =>
    n === 1
      ? round(1, 'bombed', { openedBagCount: 3, coinBagHits: 2, capturedCoins: 0 })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.totalCoins, 0)
  assert.equal(summary.threeCoinsComplete, 0)
  assert.equal(summary.coinBagHits, 2)
}

// --- CASH OUT ---
{
  const rounds = twenty((n) =>
    n === 1
      ? round(1, 'cashed_out', {
          capturedCoins: 2,
          openedBagCount: 2,
          coinBagHits: 2,
        })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.totalCoins, 2)
  assert.equal(summary.threeCoinsComplete, 0)
}

// --- TIME OUT keeps pre-timeout hits, coins 0 ---
{
  const rounds = twenty((n) =>
    n === 1
      ? round(1, 'timed_out', {
          openedBagCount: 4,
          coinBagHits: 2,
          capturedCoins: 0,
          elapsedSeconds: 60,
        })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.totalCoins, 0)
  assert.equal(summary.threeCoinsComplete, 0)
  assert.equal(summary.coinBagHits, 2)
  assert.equal(summary.totalOpens, 4)
  assert.equal(summary.totalTimeSeconds, 60 * 20)
}

// --- 0 OPEN ---
{
  const rounds = twenty((n) =>
    round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.totalOpens, 0)
  assert.equal(summary.coinBagHits, 0)
  assert.deepEqual(summary.coinBagHitRate, { numerator: 0, denominator: 0 })
}

// --- HIT RATE zero-denominator compare (0 OPEN = 0%) ---
{
  const zeroOpen = { numerator: 0, denominator: 0 }
  const zeroHits = { numerator: 0, denominator: 5 }
  const half = { numerator: 1, denominator: 2 }
  const halfEquivalent = { numerator: 2, denominator: 4 }
  const twoThirds = { numerator: 2, denominator: 3 }
  const threeQuarters = { numerator: 3, denominator: 4 }

  // 0/0 vs 1/2 → 1/2 ranks ahead (compare returns >0 means a behind b)
  assert.equal(compareDailyCoinBagHitRate(zeroOpen, half), 1)
  // 1/2 vs 0/0 → 1/2 ranks ahead
  assert.equal(compareDailyCoinBagHitRate(half, zeroOpen), -1)
  // 0/0 vs 0/0 → tie
  assert.equal(compareDailyCoinBagHitRate(zeroOpen, zeroOpen), 0)
  // 0/5 vs 0/0 → both 0% → tie
  assert.equal(compareDailyCoinBagHitRate(zeroHits, zeroOpen), 0)
  assert.equal(compareDailyCoinBagHitRate(zeroOpen, zeroHits), 0)
  // 1/2 vs 2/4 → tie
  assert.equal(compareDailyCoinBagHitRate(half, halfEquivalent), 0)
  // 2/3 vs 3/4 → 3/4 ranks ahead
  assert.equal(compareDailyCoinBagHitRate(twoThirds, threeQuarters), 1)
  assert.equal(compareDailyCoinBagHitRate(threeQuarters, twoThirds), -1)
}

// --- 0 COINS (all bomb / timeout) ---
{
  const rounds = twenty((n) =>
    n % 2 === 0
      ? round(n, 'bombed', { openedBagCount: 1, coinBagHits: 0 })
      : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  assert.equal(aggregateDailyParticipantResult(input(rounds)).totalCoins, 0)
}

// --- All TIME OUT ---
{
  const rounds = twenty((n) =>
    round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
  )
  const summary = aggregateDailyParticipantResult(input(rounds))
  assert.equal(summary.threeCoinsComplete, 0)
  assert.equal(summary.totalTimeSeconds, 1200)
}

// --- Incomplete excluded ---
{
  const nineteen = twenty((n) => round(n, 'cleared')).slice(0, 19)
  assert.equal(isCompleteDailyTerminalRoundSet(nineteen), false)
  assert.equal(tryAggregateDailyParticipantResult(input(nineteen)), null)
  assert.throws(
    () => aggregateDailyParticipantResult(input(nineteen)),
    (error: unknown) =>
      error instanceof DailyResultValidationError &&
      error.code === 'incomplete_rounds',
  )
}

// --- Missing ROUND ---
{
  const rounds = twenty((n) => round(n === 7 ? 8 : n, 'cleared'))
  // duplicate 8, missing 7
  rounds[6] = round(8, 'cleared')
  assert.equal(isCompleteDailyTerminalRoundSet(rounds), false)
  assert.throws(() => aggregateDailyParticipantResult(input(rounds)))
}

// --- Duplicate ROUND ---
{
  const rounds = twenty((n) => round(n, 'cleared'))
  rounds[19] = round(1, 'cleared')
  assert.equal(isCompleteDailyTerminalRoundSet(rounds), false)
  assert.throws(() => aggregateDailyParticipantResult(input(rounds)))
}

// --- Integer ranges ---
{
  const rounds = twenty((n) => round(n, 'cleared'))
  const summary = aggregateDailyParticipantResult(input(rounds))
  for (const value of [
    summary.totalCoins,
    summary.threeCoinsComplete,
    summary.coinBagHits,
    summary.totalOpens,
    summary.totalTimeSeconds,
  ]) {
    assert.equal(Number.isInteger(value), true)
  }
  assert.ok(summary.totalCoins >= 0 && summary.totalCoins <= 60)
  assert.ok(summary.threeCoinsComplete >= 0 && summary.threeCoinsComplete <= 20)
  assert.ok(summary.coinBagHits <= summary.totalOpens)
  assert.ok(summary.totalTimeSeconds <= 1200)
}

// --- Same nickname, different participants stay independent ---
{
  const rounds = twenty((n) => round(n, 'cleared'))
  const a = aggregateDailyParticipantResult(input(rounds, PARTICIPANT_A, 'Same'))
  const b = aggregateDailyParticipantResult(input(rounds, PARTICIPANT_B, 'Same'))
  assert.equal(a.displayNickname, b.displayNickname)
  assert.notEqual(a.participantId, b.participantId)
  assert.equal(compareDailyParticipantScores(a, b), 0)
}

// --- Score order: coins > complete > hit rate > time ---
{
  const base = twenty((n) =>
    round(n, 'cashed_out', {
      capturedCoins: 1,
      openedBagCount: 2,
      coinBagHits: 1,
      elapsedSeconds: 40,
    }),
  )
  const moreCoins = aggregateDailyParticipantResult(
    input(
      base.map((r, i) =>
        i === 0 ? round(1, 'cleared', { elapsedSeconds: 40 }) : r,
      ),
    ),
  )
  const fewerCoins = aggregateDailyParticipantResult(input(base))
  assert.ok(compareDailyParticipantScores(moreCoins, fewerCoins) < 0)

  const moreComplete = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        n <= 2
          ? round(n, 'cleared', { elapsedSeconds: 40 })
          : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
      ),
    ),
  )
  const lessComplete = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        n <= 3
          ? round(n, 'cashed_out', {
              capturedCoins: 2,
              openedBagCount: 1,
              coinBagHits: 1,
              elapsedSeconds: 40,
            })
          : round(n, 'timed_out', { openedBagCount: 0, coinBagHits: 0 }),
      ),
    ),
  )
  assert.equal(moreComplete.totalCoins, lessComplete.totalCoins)
  assert.ok(moreComplete.threeCoinsComplete > lessComplete.threeCoinsComplete)
  assert.ok(compareDailyParticipantScores(moreComplete, lessComplete) < 0)

  const highHit = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        round(n, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 2,
          coinBagHits: 2,
          elapsedSeconds: 40,
        }),
      ),
    ),
  )
  const lowHit = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        round(n, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 2,
          coinBagHits: 1,
          elapsedSeconds: 40,
        }),
      ),
    ),
  )
  assert.equal(highHit.totalCoins, lowHit.totalCoins)
  assert.equal(highHit.threeCoinsComplete, lowHit.threeCoinsComplete)
  assert.ok(compareDailyParticipantScores(highHit, lowHit) < 0)

  const fast = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        round(n, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
          elapsedSeconds: 10,
        }),
      ),
    ),
  )
  const slow = aggregateDailyParticipantResult(
    input(
      twenty((n) =>
        round(n, 'cashed_out', {
          capturedCoins: 1,
          openedBagCount: 1,
          coinBagHits: 1,
          elapsedSeconds: 50,
        }),
      ),
    ),
  )
  assert.ok(compareDailyParticipantScores(fast, slow) < 0)
}

// --- Server row mapping / completion gate ---
{
  const rounds = twenty((n) => round(n, 'cleared'))
  const attempts = rounds.map((r) => attemptFromRound(r))
  const finished = tryBuildDailyParticipantResultSummary(participant(), attempts)
  assert.ok(finished)
  assert.equal(finished!.totalCoins, 60)
  assert.equal(
    tryBuildDailyParticipantResultSummary(
      participant({ completedAt: null }),
      attempts,
    ),
    null,
  )
  assert.equal(
    tryBuildDailyParticipantResultSummary(
      participant({ expiredAt: '2099-08-02T00:00:00.000Z' }),
      attempts,
    ),
    null,
  )
  assert.equal(
    tryBuildDailyParticipantResultSummary(participant(), attempts.slice(0, 10)),
    null,
  )
  const active = attempts.map((row, index) =>
    index === 0
      ? {
          ...row,
          status: 'active',
          elapsedSeconds: null,
          capturedCoins: null,
          coinBagHits: null,
        }
      : row,
  )
  assert.equal(tryBuildDailyParticipantResultSummary(participant(), active), null)
  assert.equal(dailyAttemptRowToRoundInput(active[0]!), null)
  assert.deepEqual(dailyAttemptRowToRoundInput(attempts[0]!)?.endReason, 'cleared')
  assert.equal(
    buildDailyParticipantResultSummary(participant(), attempts).threeCoinsComplete,
    20,
  )
}

// --- Source guards: no production env / no schema migration in this step ---
{
  const domain = readFileSync(resolve(root, 'src/daily/dailyResult.ts'), 'utf8')
  const db = readFileSync(resolve(root, 'server/db/dailyResult.ts'), 'utf8')
  assert.match(domain, /threeCoinsComplete/)
  assert.match(domain, /totalTimeSeconds/)
  assert.match(domain, /compareDailyCoinBagHitRate/)
  assert.doesNotMatch(domain, /getDatabase/)
  assert.doesNotMatch(db, /getDatabase/)
  assert.doesNotMatch(db, /drizzle-kit|migrate/)
}

console.log('verify:daily-result OK')
