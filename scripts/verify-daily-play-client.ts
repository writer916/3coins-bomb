/** DAILY play client + cash-out UI + placements cache / local judge (no live net). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  bagIdToBagNumber,
  bagNumberToBagId,
  createDailyPlayCoordinator,
  DailyPlayClientError,
  judgeDailyBag,
  parseDailyCashOutResult,
  parseDailyOpenResult,
  parseDailyPlacements,
  parseDailyPlayState,
  provisionalCoinsFromOpens,
  sameDailyLocalAndServerOpen,
} from '../src/daily/dailyPlayClient.ts'
import {
  canShowDailyCashOutButton as showCash,
  isDailyCashOutButtonDisabled,
} from '../src/daily/dailyCashOutUi.ts'
import {
  calculateDailyRemainingSeconds,
  estimateDailyServerNowMs,
} from '../src/daily/dailyTime.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2099-09-10'
const otherDate = '2099-09-11'

function makePlacementsDto(challengeDate: string) {
  return {
    challengeDate,
    formationVersion: 1 as const,
    ruleVersion: 1 as const,
    placements: Array.from({ length: DAILY_CHALLENGE_ROUNDS }, (_, index) => {
      const roundNumber = index + 1
      if (roundNumber === 1) {
        return {
          roundNumber,
          bagCount: 5,
          bombBagNumber: 5,
          coinBagNumbers: [1, 2, 2] as [number, number, number],
        }
      }
      if (roundNumber === 20) {
        return {
          roundNumber,
          bagCount: 4,
          bombBagNumber: 1,
          coinBagNumbers: [2, 3, 4] as [number, number, number],
        }
      }
      return {
        roundNumber,
        bagCount: 5,
        bombBagNumber: 5,
        coinBagNumbers: [1, 2, 3] as [number, number, number],
      }
    }),
  }
}

assert.equal(bagIdToBagNumber(bagNumberToBagId(3)), 3)
assert.equal(showCash(0, false), false)
assert.equal(showCash(1, false), true)
assert.equal(showCash(2, false), true)
assert.equal(showCash(3, false), false)
assert.equal(showCash(1, true), false)
assert.equal(isDailyCashOutButtonDisabled(false, false, false), false)
assert.equal(isDailyCashOutButtonDisabled(true, false, false), true)
assert.equal(isDailyCashOutButtonDisabled(false, true, false), true)
assert.equal(isDailyCashOutButtonDisabled(false, false, true), true)

assert.equal(
  provisionalCoinsFromOpens([
    { outcome: 'coins', coinsFound: 2 },
    { outcome: 'empty', coinsFound: 0 },
  ]),
  2,
)
assert.equal(
  provisionalCoinsFromOpens([{ outcome: 'bomb', coinsFound: 0 }]),
  0,
)

const playState = parseDailyPlayState(
  {
    challengeDate: date,
    serverNow: '2099-09-10T12:00:00.000Z',
    challengeEndsAt: '2099-09-11T00:00:00.000Z',
    completedRounds: 0,
    nextRoundNumber: 1,
    completedAt: null,
    expiredAt: null,
    activeAttempt: {
      roundNumber: 1,
      bagCount: 5,
      startedAt: '2099-09-10T12:00:00.000Z',
      deadlineAt: '2099-09-10T12:01:00.000Z',
      openedBagCount: 1,
      opens: [
        {
          openOrder: 1,
          bagNumber: 2,
          remainingSecondsAtTap: 55,
          openedAt: '2099-09-10T12:00:05.000Z',
          outcome: 'coins',
          coinsFound: 2,
        },
      ],
    },
  },
  date,
)
assert.equal(playState.activeAttempt?.opens[0]?.outcome, 'coins')
assert.doesNotMatch(JSON.stringify(playState), /bombBag|coinBagNumbers/)

const openCmd = {
  challengeDate: date,
  bagNumber: 2,
  remainingSecondsAtTap: 55,
  requestId: randomUUID(),
}
const openResult = parseDailyOpenResult(
  {
    challengeDate: date,
    roundNumber: 1,
    bagNumber: 2,
    openOrder: 1,
    remainingSecondsAtTap: 55,
    outcome: 'coins',
    coinsFound: 2,
    provisionalCoins: 2,
    openedBagCount: 1,
    roundEnded: false,
    endReason: null,
    capturedCoins: 0,
    elapsedSeconds: null,
    coinBagHits: null,
    participantCompleted: false,
  },
  openCmd,
)
assert.equal(openResult.provisionalCoins, 2)

const cashCmd = {
  challengeDate: date,
  remainingSecondsAtTap: 50,
  requestId: randomUUID(),
}
assert.equal(
  parseDailyCashOutResult(
    {
      challengeDate: date,
      roundNumber: 1,
      endReason: 'cashed_out',
      capturedCoins: 2,
      openedBagCount: 1,
      elapsedSeconds: 10,
      coinBagHits: 1,
      remainingSecondsAtTap: 50,
      participantCompleted: false,
    },
    cashCmd,
  ).capturedCoins,
  2,
)

// --- Placements DTO parse ---
const placementsDto = makePlacementsDto(date)
const parsedPlacements = parseDailyPlacements(placementsDto, date)
assert.equal(parsedPlacements.placements.length, 20)
assert.equal(parsedPlacements.placements[0]!.roundNumber, 1)
assert.equal(parsedPlacements.placements[19]!.roundNumber, 20)

assert.throws(
  () => parseDailyPlacements({ ...placementsDto, challengeDate: otherDate }, date),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'INVALID_RESPONSE',
)
assert.throws(
  () =>
    parseDailyPlacements(
      { ...placementsDto, placements: placementsDto.placements.slice(0, 19) },
      date,
    ),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'INVALID_RESPONSE',
)
assert.throws(
  () =>
    parseDailyPlacements(
      {
        ...placementsDto,
        placements: placementsDto.placements.map((row, index) =>
          index === 0
            ? { ...row, coinBagNumbers: [1, 2, 5] } // bomb+coin same bag
            : row,
        ),
      },
      date,
    ),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'INVALID_RESPONSE',
)

// --- Local judge ---
assert.deepEqual(judgeDailyBag(parsedPlacements.placements[0]!, 3), {
  outcome: 'empty',
  coinsFound: 0,
})
assert.deepEqual(judgeDailyBag(parsedPlacements.placements[0]!, 1), {
  outcome: 'coins',
  coinsFound: 1,
})
assert.deepEqual(judgeDailyBag(parsedPlacements.placements[0]!, 2), {
  outcome: 'coins',
  coinsFound: 2,
})
assert.deepEqual(
  judgeDailyBag(
    {
      roundNumber: 2,
      bagCount: 4,
      bombBagNumber: 4,
      coinBagNumbers: [1, 1, 1],
    },
    1,
  ),
  { outcome: 'coins', coinsFound: 3 },
)
assert.deepEqual(judgeDailyBag(parsedPlacements.placements[0]!, 5), {
  outcome: 'bomb',
  coinsFound: 0,
})
assert.equal(
  sameDailyLocalAndServerOpen(
    { outcome: 'coins', coinsFound: 2 },
    { outcome: 'coins', coinsFound: 2 },
  ),
  true,
)
assert.equal(
  sameDailyLocalAndServerOpen(
    { outcome: 'coins', coinsFound: 2 },
    { outcome: 'coins', coinsFound: 1 },
  ),
  false,
)

// Coordinator reuses pending open request id + placements cache.
const calls: string[] = []
let placementFetches = 0
const mockClient = {
  createRequestId: () => randomUUID(),
  getPlay: async () => playState,
  startRound: async () => playState,
  getPlacements: async (challengeDate: string) => {
    placementFetches += 1
    calls.push(`placements:${challengeDate}`)
    return parseDailyPlacements(makePlacementsDto(challengeDate), challengeDate)
  },
  createOpenCommand: (challengeDate: string, bagNumber: number, remainingSecondsAtTap: number) => {
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    calls.push(requestId)
    return { challengeDate, bagNumber, remainingSecondsAtTap, requestId }
  },
  openBag: async (command: { requestId: string }) => {
    calls.push(`open:${command.requestId}`)
    return openResult
  },
  createCashOutCommand: (challengeDate: string, remainingSecondsAtTap: number) => ({
    challengeDate,
    remainingSecondsAtTap,
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }),
  cashOut: async () =>
    parseDailyCashOutResult(
      {
        challengeDate: date,
        roundNumber: 1,
        endReason: 'cashed_out',
        capturedCoins: 2,
        openedBagCount: 1,
        elapsedSeconds: 10,
        coinBagHits: 1,
        remainingSecondsAtTap: 50,
        participantCompleted: false,
      },
      cashCmd,
    ),
}

const coordinator = createDailyPlayCoordinator(mockClient as never)

assert.throws(
  () => coordinator.getLocalOpenResult(date, 1, 5, 2),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'UNAVAILABLE',
)

const loaded = await coordinator.loadOrStart(date)
assert.equal(loaded.activeAttempt?.roundNumber, 1)
assert.equal(placementFetches, 1)
assert.equal(coordinator.getCachedPlacements()?.challengeDate, date)

const localRound1 = coordinator.getLocalOpenResult(date, 1, 5, 2)
assert.deepEqual(localRound1, { outcome: 'coins', coinsFound: 2 })
assert.equal(sameDailyLocalAndServerOpen(localRound1, openResult), true)

const emptyLocal = coordinator.getLocalOpenResult(date, 1, 5, 3)
assert.deepEqual(emptyLocal, { outcome: 'empty', coinsFound: 0 })
const bombLocal = coordinator.getLocalOpenResult(date, 1, 5, 5)
assert.deepEqual(bombLocal, { outcome: 'bomb', coinsFound: 0 })

// Wrong bagCount / date must not judge.
assert.throws(
  () => coordinator.getLocalOpenResult(date, 1, 4, 2),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'UNAVAILABLE',
)
assert.throws(
  () => coordinator.getLocalOpenResult(otherDate, 1, 5, 2),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'UNAVAILABLE',
)

// ROUND 20 slot after startNext with remapped active attempt.
const round20State = {
  ...playState,
  completedRounds: 19,
  nextRoundNumber: 20,
  activeAttempt: {
    roundNumber: 20,
    bagCount: 4,
    startedAt: '2099-09-10T12:00:00.000Z',
    deadlineAt: '2099-09-10T12:01:00.000Z',
    openedBagCount: 0,
    opens: [],
  },
}
const coord2 = createDailyPlayCoordinator({
  ...mockClient,
  getPlay: async () => ({
    ...playState,
    activeAttempt: null,
    completedRounds: 19,
    nextRoundNumber: 20,
  }),
  startRound: async () => round20State,
} as never)
await coord2.loadOrStart(date)
const next = await coord2.startNext(date)
assert.equal(next.activeAttempt?.roundNumber, 20)
assert.equal(placementFetches, 2) // loadOrStart cleared + re-fetched
assert.deepEqual(coord2.getLocalOpenResult(date, 20, 4, 1), {
  outcome: 'bomb',
  coinsFound: 0,
})
assert.deepEqual(coord2.getLocalOpenResult(date, 20, 4, 2), {
  outcome: 'coins',
  coinsFound: 1,
})

// Resume path: active attempt still loads placements.
const resumeCoord = createDailyPlayCoordinator(mockClient as never)
const resumed = await resumeCoord.loadOrStart(date)
assert.ok(resumed.activeAttempt)
assert.equal(resumeCoord.getCachedPlacements()?.placements.length, 20)

// Same-day startNext reuses cache (no extra fetch after ensure).
const fetchesBeforeNext = placementFetches
const coordReuse = createDailyPlayCoordinator(mockClient as never)
await coordReuse.loadOrStart(date)
const fetchesAfterLoad = placementFetches
await coordReuse.startNext(date)
assert.equal(placementFetches, fetchesAfterLoad)

const first = await coordinator.open(date, 2, 55)
assert.equal(first.coinsFound, 2)
assert.equal(calls.filter((c) => c.startsWith('open:')).length, 1)
void fetchesBeforeNext

// --- OptimisticOpenGate: FX may finish before/after delayed API ---
const {
  createOptimisticOpenGate,
  markOptimisticFailed,
  markOptimisticFxDone,
  markOptimisticServerDone,
} = await import('../src/duel/duelOptimisticOpen.ts')

{
  const gate = createOptimisticOpenGate()
  assert.equal(markOptimisticFxDone(gate), false)
  assert.equal(markOptimisticServerDone(gate), true)
}
{
  const gate = createOptimisticOpenGate()
  assert.equal(markOptimisticServerDone(gate), false)
  assert.equal(markOptimisticFxDone(gate), true)
}
{
  const gate = createOptimisticOpenGate()
  markOptimisticFailed(gate)
  assert.equal(markOptimisticFxDone(gate), false)
  assert.equal(markOptimisticServerDone(gate), false)
}

// Artificial API delay must not block local judge (source of immediate FX).
{
  let openStarted = false
  const slow = createDailyPlayCoordinator({
    ...mockClient,
    openBag: async () => {
      openStarted = true
      await new Promise((resolve) => setTimeout(resolve, 40))
      return openResult
    },
  } as never)
  await slow.loadOrStart(date)
  const localAtTap = slow.getLocalOpenResult(date, 1, 5, 2)
  assert.deepEqual(localAtTap, { outcome: 'coins', coinsFound: 2 })
  assert.equal(openStarted, false, 'local judge must not await open')
  const openPromise = slow.open(date, 2, 55)
  assert.equal(openStarted, true)
  assert.equal(sameDailyLocalAndServerOpen(localAtTap, await openPromise), true)
}

// Idempotent pending OPEN keeps the first R / request id across retries.
{
  const ids: string[] = []
  const flaky = createDailyPlayCoordinator({
    ...mockClient,
    createOpenCommand: (
      challengeDate: string,
      bagNumber: number,
      remainingSecondsAtTap: number,
    ) => {
      const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      ids.push(`${requestId}:${remainingSecondsAtTap}`)
      return { challengeDate, bagNumber, remainingSecondsAtTap, requestId }
    },
    openBag: async () => {
      throw new DailyPlayClientError('TEMPORARY_FAILURE')
    },
  } as never)
  await flaky.loadOrStart(date)
  await assert.rejects(() => flaky.open(date, 2, 55))
  assert.ok(flaky.getPendingOpen())
  assert.equal(flaky.getPendingOpen()?.remainingSecondsAtTap, 55)
  await assert.rejects(() => flaky.open(date, 2, 40))
  assert.equal(ids.length, 1, 'retry must reuse first command including R')
}

const started = Date.parse('2099-09-10T12:00:00.000Z')
assert.equal(
  calculateDailyRemainingSeconds(started + 60_000, started + 10_000),
  50,
)
assert.equal(
  estimateDailyServerNowMs(started, 1000, 1500),
  started + 500,
)
assert.equal(calculateDailyRemainingSeconds(started + 60_000, started + 60_000), 0)

const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')
const playScreen = read('src/components/DailyPlayScreen.tsx')
assert.match(playScreen, /canShowDailyCashOutButton/)
assert.match(playScreen, /isDailyCashOutButtonDisabled/)
assert.match(playScreen, /remainingSecondsAtTap/)
assert.match(playScreen, /coordinator\.open/)
assert.match(playScreen, /coordinator\.cashOut/)
assert.match(playScreen, /calculateDailyRemainingSeconds/)
assert.doesNotMatch(playScreen, /bombBagNumber|coinBagNumbers/)
assert.match(playScreen, /getLocalOpenResult/)
assert.match(playScreen, /createOptimisticOpenGate/)
assert.match(playScreen, /markOptimisticServerDone/)
assert.match(playScreen, /sameDailyLocalAndServerOpen/)
assert.match(playScreen, /startFx\(local/)
{
  const tapAt = playScreen.indexOf('const tap = useCallback')
  const fxAt = playScreen.indexOf('startFx(local', tapAt)
  const openAt = playScreen.indexOf('await coordinator.open', tapAt)
  assert.ok(tapAt >= 0 && fxAt > tapAt && openAt > fxAt, 'FX before await open')
}
assert.doesNotMatch(playScreen, /setPendingBagId|daily-play__open-pending/)
assert.match(playScreen, /disabled=\{cashOutDisabled\}/)
assert.doesNotMatch(
  playScreen,
  /canShowDailyCashOutButton\([^)]*fx/,
)
assert.match(
  playScreen,
  /requestPending \|\|[\s\S]*fx !== null/,
  'timeout poll must not run during in-flight OPEN/FX',
)
assert.match(read('src/daily/dailyPlayClient.ts'), /getPlacements/)
assert.match(read('src/daily/dailyPlayClient.ts'), /getLocalOpenResult/)
assert.match(read('src/daily/dailyLocalOpen.ts'), /judgeDailyBag/)
assert.match(read('src/components/GroupPlayScreen.tsx'), /createOptimisticOpenGate/)

const prestart = read('src/components/DailyPreStartScreen.tsx')
assert.match(prestart, /createDailyParticipantCoordinator/)
assert.match(prestart, /createDailyPlayCoordinator/)
assert.match(prestart, /onEnterPlay/)
assert.match(prestart, /loadOrStart/)

const app = read('src/App.tsx')
assert.match(app, /DailyPlayScreen/)
assert.match(app, /dailyPhase/)
assert.doesNotMatch(app, /GroupPlayScreen/)

for (const modeFile of [
  'src/components/GroupPlayScreen.tsx',
  'src/components/DuelPlayScreen.tsx',
]) {
  const before = read(modeFile)
  assert.match(before, /cash-out-btn|cashOut/)
}

assert.match(read('src/i18n/en.ts'), /dailyChallengeComplete/)
assert.match(read('src/i18n/ja.ts'), /dailyChallengeComplete/)
assert.equal(
  (await import('../src/i18n/en.ts')).en.cashOut,
  'CASH OUT',
)
assert.equal(
  (await import('../src/i18n/ja.ts')).ja.cashOut,
  'ここで利確',
)

console.log('verify:daily-play-client OK')
