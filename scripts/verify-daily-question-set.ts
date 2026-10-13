/** DAILY question-set domain + provider (no database). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  QUESTION_BAG_WEIGHTS,
  questionPlacementKey,
} from '../src/game/questionGeneration'
import {
  DAILY_CHALLENGE_ROUNDS,
  dailyQuestionRoundsFromPlacements,
  validateDailyQuestionRounds,
  validateDailyQuestionSet,
} from '../src/daily/dailyQuestionSet'
import { provideDailyQuestionRounds } from '../server/daily/provideDailyQuestionSet'
import { getOrCreateDailyQuestionSet } from '../server/daily/getOrCreateDailyQuestionSet'
import type { DailyQuestionRandomSource } from '../server/daily/provideDailyQuestionSet'

function seededRandom(seedValue: number): DailyQuestionRandomSource {
  let seed = seedValue >>> 0
  return {
    next() {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    },
  }
}

assert.equal(DAILY_CHALLENGE_ROUNDS, 20)
assert.deepEqual(QUESTION_BAG_WEIGHTS, {
  3: 5, 4: 10, 5: 15, 6: 25, 7: 25, 8: 20,
})

const rounds = provideDailyQuestionRounds(seededRandom(42))
assert.equal(rounds.length, 20)
assert.equal(new Set(rounds.map(questionPlacementKey)).size, 20)
assert.deepEqual(
  validateDailyQuestionRounds(rounds),
  rounds,
)

const same = provideDailyQuestionRounds(seededRandom(42))
assert.deepEqual(same.map(questionPlacementKey), rounds.map(questionPlacementKey))
const other = provideDailyQuestionRounds(seededRandom(43))
assert.notDeepEqual(
  other.map(questionPlacementKey),
  rounds.map(questionPlacementKey),
)

assert.throws(() =>
  validateDailyQuestionRounds(rounds.slice(0, 19)),
)
assert.throws(() =>
  validateDailyQuestionRounds([
    ...rounds.slice(0, 19),
    { ...rounds[0]!, roundNumber: 20 },
  ]),
)
assert.throws(() =>
  validateDailyQuestionRounds(
    rounds.map((round, index) =>
      index === 0
        ? {
            ...round,
            bombBagNumber: round.coinBagNumbers[0]!,
          }
        : round,
    ),
  ),
)

const providerSource = readFileSync(
  resolve(process.cwd(), 'server/daily/provideDailyQuestionSet.ts'),
  'utf8',
)
assert(providerSource.includes('generateUniqueQuestionSet('))
assert(providerSource.includes('DAILY_CHALLENGE_ROUNDS'))

// Concurrent create: both generate different candidates; only the persisted
// winner is returned to every caller.
let persistCalls = 0
const winner = {
  challengeDate: '2026-10-14',
  createdAt: '2026-10-14T00:00:01.000Z',
  created: true,
  formationVersion: 1 as const,
  ruleVersion: 1 as const,
  rounds,
}
const resolved = await Promise.all([
  getOrCreateDailyQuestionSet('2026-10-14', {
    load: async () => null,
    provideRounds: () => rounds,
    persistOrLoad: async () => {
      persistCalls += 1
      return { ...winner, created: persistCalls === 1 }
    },
  }),
  getOrCreateDailyQuestionSet('2026-10-14', {
    load: async () => null,
    provideRounds: () => other,
    persistOrLoad: async () => {
      persistCalls += 1
      return { ...winner, created: false, rounds }
    },
  }),
])
assert.equal(persistCalls, 2)
assert.deepEqual(
  resolved[0]!.rounds.map(questionPlacementKey),
  resolved[1]!.rounds.map(questionPlacementKey),
)
assert.deepEqual(
  resolved[0]!.rounds.map(questionPlacementKey),
  rounds.map(questionPlacementKey),
)

// Reuse path: load hits first — provider/persist must not run.
let provideCount = 0
let persistCount = 0
const reused = await getOrCreateDailyQuestionSet('2026-10-14', {
  load: async () => validateDailyQuestionSet({ ...winner, created: false }),
  provideRounds: () => {
    provideCount += 1
    return other
  },
  persistOrLoad: async () => {
    persistCount += 1
    return winner
  },
})
assert.equal(provideCount, 0)
assert.equal(persistCount, 0)
assert.equal(reused.created, false)
assert.equal(reused.challengeDate, '2026-10-14')

// Distinct UTC dates stay independent in orchestration inputs.
const dates = new Set<string>()
await getOrCreateDailyQuestionSet('2026-10-14', {
  load: async () => null,
  provideRounds: () => rounds,
  persistOrLoad: async ({ challengeDate }) => {
    dates.add(challengeDate)
    return { ...winner, challengeDate, rounds }
  },
})
await getOrCreateDailyQuestionSet('2026-10-15', {
  load: async () => null,
  provideRounds: () => other,
  persistOrLoad: async ({ challengeDate }) => {
    dates.add(challengeDate)
    return {
      ...winner,
      challengeDate,
      rounds: other,
    }
  },
})
assert.deepEqual([...dates].sort(), ['2026-10-14', '2026-10-15'])

assert.deepEqual(
  dailyQuestionRoundsFromPlacements(
    rounds.map(({ bagCount, bombBagNumber, coinBagNumbers }) => ({
      bagCount,
      bombBagNumber,
      coinBagNumbers,
    })),
  ).map(questionPlacementKey),
  rounds.map(questionPlacementKey),
)

console.log('verify:daily-question-set OK')
