/** DAILY pending OPEN/CASH OUT persistence and retry checks (no DB/network). */
import assert from 'node:assert/strict'
import {
  createDailyPlayCoordinator,
  DailyPlayClientError,
} from '../src/daily/dailyPlayClient.ts'
import {
  clearDailyPendingOperation,
  DAILY_PENDING_OPERATION_KEY,
  readDailyPendingOperation,
  saveDailyPendingOperation,
} from '../src/daily/dailyPendingOperationStorage.ts'
import { resolveDailyDisplayEndKind } from '../src/daily/dailyRoundEndUi.ts'

const date = '2099-09-10'
const participantId = '11111111-1111-4111-8111-111111111111'
const openRequestId = '22222222-2222-4222-8222-222222222222'
const cashRequestId = '33333333-3333-4333-8333-333333333333'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

const openPending = {
  version: 1 as const,
  kind: 'open' as const,
  challengeDate: date,
  participantId,
  roundNumber: 4,
  bagNumber: 3,
  requestId: openRequestId,
  remainingSecondsAtTap: 17,
}
const cashPending = {
  version: 1 as const,
  kind: 'cash_out' as const,
  challengeDate: date,
  participantId,
  roundNumber: 4,
  requestId: cashRequestId,
  remainingSecondsAtTap: 16,
}

const storage = new MemoryStorage()
saveDailyPendingOperation(storage, openPending)
assert.deepEqual(readDailyPendingOperation(storage), openPending)
clearDailyPendingOperation(storage)
assert.equal(readDailyPendingOperation(storage), null)
saveDailyPendingOperation(storage, cashPending)
assert.deepEqual(readDailyPendingOperation(storage), cashPending)

for (const invalid of [
  '{bad',
  JSON.stringify({ ...openPending, challengeDate: '2099-09-11' }),
  JSON.stringify({ ...openPending, challengeDate: '2099-02-30' }),
  JSON.stringify({ ...openPending, requestId: 'bad' }),
  JSON.stringify({ ...openPending, roundNumber: 0 }),
  JSON.stringify({ ...openPending, remainingSecondsAtTap: 0 }),
  JSON.stringify({ ...openPending, extra: true }),
]) {
  storage.values.set(DAILY_PENDING_OPERATION_KEY, invalid)
  const parsed = readDailyPendingOperation(storage)
  if (invalid.includes('2099-09-11')) assert.equal(parsed?.challengeDate, '2099-09-11')
  else assert.equal(parsed, null)
}

const activeState = {
  challengeDate: date,
  serverNow: '2099-09-10T12:00:10.000Z',
  challengeEndsAt: '2099-09-11T00:00:00.000Z',
  completedRounds: 3,
  nextRoundNumber: 4,
  activeAttempt: {
    roundNumber: 4,
    bagCount: 5,
    startedAt: '2099-09-10T12:00:00.000Z',
    deadlineAt: '2099-09-10T12:01:00.000Z',
    openedBagCount: 0,
    opens: [],
  },
  completedAt: null,
  expiredAt: null,
} as const
const placements = {
  challengeDate: date,
  formationVersion: 1 as const,
  ruleVersion: 1 as const,
  placements: Array.from({ length: 20 }, (_, index) => ({
    roundNumber: index + 1,
    bagCount: 5,
    bombBagNumber: 5,
    coinBagNumbers: [1, 2, 3] as [number, number, number],
  })),
}
const result = {
  challengeDate: date,
  roundNumber: 4,
  bagNumber: 3,
  openOrder: 1,
  remainingSecondsAtTap: 17,
  outcome: 'coins' as const,
  coinsFound: 1 as const,
  provisionalCoins: 1 as const,
  openedBagCount: 1,
  roundEnded: false,
  endReason: null,
  capturedCoins: 1 as const,
  elapsedSeconds: null,
  coinBagHits: null,
  participantCompleted: false,
}

const retryStorage = new MemoryStorage()
saveDailyPendingOperation(retryStorage, openPending)
const sent: Array<{ requestId: string; remainingSecondsAtTap: number }> = []
let release!: () => void
const delayed = new Promise<void>((resolve) => {
  release = resolve
})
const coordinator = createDailyPlayCoordinator(
  {
    getPlay: async () => activeState,
    getPlacements: async () => placements,
    startRound: async () => activeState,
    createRequestId: () => crypto.randomUUID(),
    createOpenCommand: () => {
      throw new Error('restored OPEN must not create a new command')
    },
    openBag: async (command: typeof result & { requestId: string }) => {
      sent.push(command)
      await delayed
      return result
    },
    createCashOutCommand: () => {
      throw new Error('not used')
    },
    cashOut: async () => {
      throw new Error('not used')
    },
  } as never,
  { storage: retryStorage, participantId },
)
await coordinator.loadOrStart(date)
assert.deepEqual(coordinator.getPendingOpen(), {
  challengeDate: date,
  bagNumber: 3,
  requestId: openRequestId,
  remainingSecondsAtTap: 17,
})
const first = coordinator.open(date, 3, 1)
await assert.rejects(
  () => coordinator.open(date, 3, 1),
  (error: unknown) =>
    error instanceof DailyPlayClientError && error.code === 'CONFLICT',
)
release()
await first
assert.deepEqual(sent, [
  { ...openPending, version: undefined, kind: undefined, participantId: undefined, roundNumber: undefined },
].map(({ version: _v, kind: _k, participantId: _p, roundNumber: _r, ...command }) => command))
assert.equal(readDailyPendingOperation(retryStorage), null)

const cashStorage = new MemoryStorage()
saveDailyPendingOperation(cashStorage, cashPending)
let cashSent: unknown = null
const cashCoordinator = createDailyPlayCoordinator(
  {
    getPlay: async () => activeState,
    getPlacements: async () => placements,
    startRound: async () => activeState,
    createRequestId: () => crypto.randomUUID(),
    createOpenCommand: () => {
      throw new Error('not used')
    },
    openBag: async () => {
      throw new Error('not used')
    },
    createCashOutCommand: () => {
      throw new Error('restored CASH OUT must not create a new command')
    },
    cashOut: async (command: unknown) => {
      cashSent = command
      return {
        challengeDate: date,
        roundNumber: 4,
        endReason: 'cashed_out' as const,
        capturedCoins: 1 as const,
        openedBagCount: 1,
        elapsedSeconds: 44,
        coinBagHits: 1,
        remainingSecondsAtTap: 16,
        participantCompleted: false,
      }
    },
  } as never,
  { storage: cashStorage, participantId },
)
await cashCoordinator.loadOrStart(date)
await cashCoordinator.cashOut(date, 1)
assert.deepEqual(cashSent, {
  challengeDate: date,
  requestId: cashRequestId,
  remainingSecondsAtTap: 16,
})
assert.equal(readDailyPendingOperation(cashStorage), null)

// A terminal mutation whose response was lost has no active attempt in GET
// play. The stored ROUND must still be used for the idempotent retry.
const terminalCashStorage = new MemoryStorage()
saveDailyPendingOperation(terminalCashStorage, cashPending)
let terminalCashSent = false
const terminalCashCoordinator = createDailyPlayCoordinator(
  {
    getPlay: async () => ({
      ...activeState,
      completedRounds: 4,
      nextRoundNumber: 5,
      activeAttempt: null,
    }),
    getPlacements: async () => placements,
    cashOut: async () => {
      terminalCashSent = true
      return {
        challengeDate: date,
        roundNumber: 4,
        endReason: 'cashed_out' as const,
        capturedCoins: 1 as const,
        openedBagCount: 1,
        elapsedSeconds: 44,
        coinBagHits: 1,
        remainingSecondsAtTap: 16,
        participantCompleted: false,
      }
    },
  } as never,
  { storage: terminalCashStorage, participantId },
)
await terminalCashCoordinator.loadOrStart(date)
await terminalCashCoordinator.cashOut(date, 1)
assert.equal(terminalCashSent, true)
assert.equal(readDailyPendingOperation(terminalCashStorage), null)

const mismatchStorage = new MemoryStorage()
saveDailyPendingOperation(mismatchStorage, openPending)
const mismatch = createDailyPlayCoordinator(
  {
    getPlay: async () => ({ ...activeState, challengeDate: '2099-09-11' }),
    getPlacements: async () => ({ ...placements, challengeDate: '2099-09-11' }),
  } as never,
  { storage: mismatchStorage, participantId },
)
await mismatch.loadOrStart('2099-09-11')
assert.equal(readDailyPendingOperation(mismatchStorage), null)

for (const recoveryParticipantId of [
  '44444444-4444-4444-8444-444444444444',
  participantId,
]) {
  const scoped = new MemoryStorage()
  saveDailyPendingOperation(scoped, {
    ...openPending,
    roundNumber: recoveryParticipantId === participantId ? 3 : 4,
  })
  const scopedCoordinator = createDailyPlayCoordinator(
    {
      getPlay: async () => activeState,
      getPlacements: async () => placements,
      startRound: async () => activeState,
    } as never,
    { storage: scoped, participantId: recoveryParticipantId },
  )
  await scopedCoordinator.loadOrStart(date)
  assert.equal(readDailyPendingOperation(scoped), null)
}

assert.equal(
  resolveDailyDisplayEndKind({
    state: { ...activeState, activeAttempt: null, completedRounds: 4, nextRoundNumber: 5 },
    hadInTimePendingAction: true,
  }),
  'connection_error_end',
)

console.log('verify:daily-pending-operation OK')
