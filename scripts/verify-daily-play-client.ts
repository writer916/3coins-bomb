/** DAILY play client + cash-out UI + placements cache / local judge (no live net). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  bagIdToBagNumber,
  bagNumberToBagId,
  createDailyPlayClient,
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
import {
  canOpenDailyResult,
  canScheduleDailyRecoveryRetry,
  classifyInactivePlaySync,
  DAILY_RECOVERY_MAX_AUTOMATIC_RETRIES,
  dailyRecoveryRetryDelayMs,
  dailyTerminalRemainingSeconds,
  hasInTimePendingAction,
  nextDailyStatusPollDelayMs,
  resolveDailyDisplayEndKind,
  shouldDiscardStalePlaySync,
} from '../src/daily/dailyRoundEndUi.ts'
import { DAILY_CHALLENGE_ROUNDS } from '../src/daily/dailyQuestionSet.ts'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')
const date = '2099-09-10'
const otherDate = '2099-09-11'

assert.equal(
  canOpenDailyResult({
    completedAt: null,
    completedRounds: 19,
    hasTerminal: true,
    terminalParticipantCompleted: false,
  }),
  false,
)
assert.equal(
  canOpenDailyResult({
    completedAt: null,
    completedRounds: 19,
    hasTerminal: true,
    terminalParticipantCompleted: true,
  }),
  true,
)
assert.equal(
  canOpenDailyResult({
    completedAt: '2099-09-10T12:20:00.000Z',
    completedRounds: 20,
    hasTerminal: false,
    terminalParticipantCompleted: false,
  }),
  true,
)
assert.equal(
  canOpenDailyResult({
    completedAt: null,
    completedRounds: 20,
    hasTerminal: true,
    terminalParticipantCompleted: false,
  }),
  true,
)

assert.equal(DAILY_RECOVERY_MAX_AUTOMATIC_RETRIES, 5)
assert.deepEqual(
  Array.from({ length: 5 }, (_, index) => dailyRecoveryRetryDelayMs(index + 1)),
  [500, 1_000, 2_000, 4_000, 8_000],
)
assert.equal(canScheduleDailyRecoveryRetry(0), true)
assert.equal(canScheduleDailyRecoveryRetry(4), true)
assert.equal(canScheduleDailyRecoveryRetry(5), false)
assert.equal(canScheduleDailyRecoveryRetry(-1), false)
assert.equal(dailyTerminalRemainingSeconds({ kind: 'open', remainingSecondsAtTap: 37 }), 37)
assert.equal(dailyTerminalRemainingSeconds({ kind: 'cash', remainingSecondsAtTap: 12 }), 12)
assert.equal(dailyTerminalRemainingSeconds({ kind: 'timeout' }), 0)
assert.equal(dailyTerminalRemainingSeconds({ kind: 'connection_error_end' }), 0)

// Chrome's native window.fetch rejects a non-Window receiver. Keep the play
// client from invoking a supplied fetch as a method of its dependency object.
const participantStorageJson = JSON.stringify({
  version: 1,
  phase: 'joined',
  challengeDate: date,
  joinRequestId: '11111111-1111-4111-8111-111111111111',
  participantId: '22222222-2222-4222-8222-222222222222',
  nickname: 'Player',
  token: `3cb_dp1_${'A'.repeat(43)}`,
  acceptedAt: '2099-09-10T00:00:00.000Z',
})
const receiverSensitiveFetch = async function (
  this: unknown,
): Promise<Response> {
  assert.equal(this, globalThis)
  return Response.json(makePlacementsDto(date))
}
const receiverSafeClient = createDailyPlayClient({
  storage: {
    getItem: () => participantStorageJson,
    setItem: () => undefined,
  },
  fetch: receiverSensitiveFetch as typeof fetch,
  crypto: globalThis.crypto,
})
assert.equal((await receiverSafeClient.getPlacements(date)).placements.length, 20)

let dailyTimeoutSignalAborted = false
const timeoutClient = createDailyPlayClient({
  storage: {
    getItem: () => participantStorageJson,
    setItem: () => undefined,
  },
  requestTimeoutMs: 10,
  fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => { dailyTimeoutSignalAborted = true })
    return new Promise<Response>(() => undefined)
  }) as typeof fetch,
  crypto: globalThis.crypto,
})
await assert.rejects(
  () => timeoutClient.getPlacements(date),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'TIMEOUT',
)
assert.equal(dailyTimeoutSignalAborted, true)

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
    totalCoins: 0,
    threeCoinsComplete: 0,
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
    latestTerminalAttempt: null,
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

// Response loss: the server applies once; retrying the persisted command with
// the same id/R returns that result without a second logical OPEN.
{
  const commands: Array<{ requestId: string; remainingSecondsAtTap: number }> = []
  let appliedOpens = 0
  const responseLost = createDailyPlayCoordinator({
    ...mockClient,
    createOpenCommand: (
      challengeDate: string,
      bagNumber: number,
      remainingSecondsAtTap: number,
    ) => ({
      challengeDate,
      bagNumber,
      remainingSecondsAtTap,
      requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }),
    openBag: async (command: {
      requestId: string
      remainingSecondsAtTap: number
    }) => {
      commands.push(command)
      if (commands.length === 1) {
        appliedOpens += 1
        throw new DailyPlayClientError('TEMPORARY_FAILURE')
      }
      return openResult
    },
  } as never)
  await responseLost.loadOrStart(date)
  await assert.rejects(() => responseLost.open(date, 2, 44))
  assert.equal(responseLost.getPendingOpen()?.remainingSecondsAtTap, 44)
  assert.equal((await responseLost.open(date, 2, 9)).bagNumber, 2)
  assert.equal(appliedOpens, 1)
  assert.equal(commands.length, 2)
  assert.equal(commands[0]?.requestId, commands[1]?.requestId)
  assert.equal(commands[0]?.remainingSecondsAtTap, 44)
  assert.equal(commands[1]?.remainingSecondsAtTap, 44)
}

// A second OPEN cannot overlap an in-flight OPEN.
{
  let releaseFirst!: () => void
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let openCalls = 0
  const serialized = createDailyPlayCoordinator({
    ...mockClient,
    openBag: async () => {
      openCalls += 1
      await firstBlocked
      return openResult
    },
  } as never)
  await serialized.loadOrStart(date)
  const firstOpen = serialized.open(date, 2, 50)
  await assert.rejects(
    () => serialized.open(date, 2, 50),
    (error: unknown) =>
      error instanceof DailyPlayClientError && error.code === 'CONFLICT',
  )
  assert.equal(openCalls, 1)
  releaseFirst()
  await firstOpen
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
assert.match(playScreen, /reconcileAfterMutationFailure/)
assert.match(playScreen, /resolveDailyDisplayEndKind|dailyRoundEndUi/)
assert.match(playScreen, /nextDailyStatusPollDelayMs/)
assert.match(playScreen, /addEventListener\('online'/)
assert.doesNotMatch(playScreen, /attempt < 8/)
assert.match(playScreen, /requestPendingRef/)
assert.match(playScreen, /fxRef/)
// ROUND-end copy under the board was removed; keep the terminal kind wiring.
assert.match(playScreen, /connection_error_end/)
assert.match(playScreen, /dailyConnectionError/)
assert.match(playScreen, /dailyChallengeEndedLabel/)
// In-play provisional stats match SOLO labels/stack; ROUNDS stay in the top index only.
assert.match(playScreen, /soloCoinsLabel/)
assert.match(playScreen, /daily-play__mid-actions/)
assert.match(playScreen, /daily-play__session/)
assert.match(playScreen, /score-stack/)
assert.match(playScreen, /withDuelNums\('3COINS COMPLETE'\)/)
{
  const playReturn = playScreen.lastIndexOf('return (')
  const playBlock = playScreen.slice(playReturn)
  assert.match(playBlock, /soloCoinsLabel/)
  assert.doesNotMatch(playBlock, /duelTotalCoins/)
  assert.doesNotMatch(playBlock, /soloRoundsLabel|dailyRoundsLabel/)
  const timerAt = playBlock.indexOf('daily-play__timer')
  const boardAt = playBlock.indexOf('daily-play__board')
  const midAt = playBlock.indexOf('daily-play__mid-actions')
  const sessionAt = playBlock.indexOf('daily-play__session')
  assert.ok(
    timerAt >= 0 &&
      boardAt > timerAt &&
      midAt > boardAt &&
      sessionAt > midAt,
    'DAILY play order: timer → board → mid-actions → session scores',
  )
}
assert.match(read('src/App.css'), /\.daily-play__mid-actions/)
assert.match(read('src/App.css'), /\.daily-play__session/)
assert.match(read('src/daily/dailyPlayClient.ts'), /getPlacements/)
assert.match(read('src/daily/dailyPlayClient.ts'), /getLocalOpenResult/)
assert.match(read('src/daily/dailyPlayClient.ts'), /clearPendingOpen/)
assert.match(read('src/daily/dailyPlayClient.ts'), /clearPendingCashOut/)
assert.match(read('src/daily/dailyLocalOpen.ts'), /judgeDailyBag/)
assert.match(read('src/components/GroupPlayScreen.tsx'), /createOptimisticOpenGate/)

const idleEnded = {
  challengeDate: date,
  serverNow: '2099-09-10T12:01:02.000Z',
  challengeEndsAt: '2099-09-11T00:00:00.000Z',
  completedRounds: 1,
  totalCoins: 0,
  threeCoinsComplete: 0,
  nextRoundNumber: 2,
  activeAttempt: null,
  completedAt: null,
  expiredAt: null,
} as const

assert.equal(
  resolveDailyDisplayEndKind({
    state: idleEnded,
    hadInTimePendingAction: false,
  }),
  'timeout',
)
assert.equal(
  resolveDailyDisplayEndKind({
    state: idleEnded,
    hadInTimePendingAction: true,
  }),
  'connection_error_end',
  'in-time pending + server timed_out must not show plain TIME OUT',
)
assert.equal(
  resolveDailyDisplayEndKind({
    state: { ...idleEnded, expiredAt: '2099-09-11T00:00:00.000Z' },
    hadInTimePendingAction: true,
  }),
  'challenge_ended',
  'UTC expiry must win over connection-error-end',
)
assert.equal(
  resolveDailyDisplayEndKind({
    state: {
      ...idleEnded,
      activeAttempt: {
        roundNumber: 1,
        bagCount: 5,
        startedAt: '2099-09-10T12:00:00.000Z',
        deadlineAt: '2099-09-10T12:01:00.000Z',
        openedBagCount: 0,
        opens: [],
      },
    },
    hadInTimePendingAction: true,
  }),
  null,
)

assert.equal(
  hasInTimePendingAction({
    pendingOpenRemainingSeconds: 1,
    pendingCashOutRemainingSeconds: null,
  }),
  true,
)
assert.equal(
  hasInTimePendingAction({
    pendingOpenRemainingSeconds: null,
    pendingCashOutRemainingSeconds: null,
  }),
  false,
)
assert.equal(nextDailyStatusPollDelayMs(500), 1000)
assert.equal(nextDailyStatusPollDelayMs(8_000), 15_000)
assert.equal(nextDailyStatusPollDelayMs(15_000), 15_000)

assert.equal(
  classifyInactivePlaySync({
    hasActiveAttempt: false,
    hasInTimePendingAction: true,
  }),
  'defer_end_for_recovery',
  'accepted BOMB/cash with lost response must defer end until idempotent restore',
)
assert.equal(
  classifyInactivePlaySync({
    hasActiveAttempt: false,
    hasInTimePendingAction: false,
  }),
  'classify_end',
)
assert.equal(
  classifyInactivePlaySync({
    hasActiveAttempt: true,
    hasInTimePendingAction: true,
  }),
  'active',
)

assert.equal(
  shouldDiscardStalePlaySync({
    cancelled: true,
    syncEpoch: 1,
    currentEpoch: 1,
    hasTerminal: false,
  }),
  true,
)
assert.equal(
  shouldDiscardStalePlaySync({
    cancelled: false,
    syncEpoch: 1,
    currentEpoch: 2,
    hasTerminal: false,
  }),
  true,
  'ROUND1 poll must not apply after ROUND2 epoch bump',
)
assert.equal(
  shouldDiscardStalePlaySync({
    cancelled: false,
    syncEpoch: 3,
    currentEpoch: 3,
    hasTerminal: true,
  }),
  true,
)
assert.equal(
  shouldDiscardStalePlaySync({
    cancelled: false,
    syncEpoch: 3,
    currentEpoch: 3,
    hasTerminal: false,
  }),
  false,
)

assert.match(playScreen, /shouldDiscardStalePlaySync/)
assert.match(playScreen, /classifyInactivePlaySync|defer_end_for_recovery/)
assert.match(playScreen, /playEpochRef/)
assert.match(playScreen, /reconcileInFlightRef/)

assert.equal(en.dailyTimeoutLabel, 'TIME OUT')
assert.equal(
  en.dailyRankingRule,
  'To appear in the ranking, you must finish 20 ROUNDS during the challenge period, and your final action must reach the server before the period ends.',
)
assert.equal(en.dailyConnectionErrorEnd, 'ROUND ENDED — CONNECTION ERROR')
assert.equal(en.dailyConnectionError, 'CONNECTION ERROR')
assert.equal(en.dailyChallengeEndedLabel, 'CHALLENGE ENDED')
assert.equal(ja.dailyConnectionErrorEnd, '通信エラーで終了')
assert.equal(ja.dailyConnectionError, '通信エラー')
assert.equal(ja.dailyChallengeEndedLabel, '開催終了')

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
assert.equal(en.cashOut, 'CASH OUT')
assert.equal(ja.cashOut, 'ここで利確')

console.log('verify:daily-play-client OK')
