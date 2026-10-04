/** Browser DUEL exploration orchestration and UI boundary checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildDuelRevealPlan,
  canAdvanceDuelPlay,
  canOfferDuelCashOut,
  createDuelPlayCoordinator,
  DuelPlayCoordinatorError,
  isDuelPlayReady,
  selectDuelDisplayedRound,
} from '../src/duel/duelPlayCoordinator'
import {
  DuelPlayClientError,
  type DuelCashOutCommand,
  type DuelOpenCommand,
} from '../src/duel/duelPlayClient'
import type { DuelOpponentPlacementSet } from '../src/duel/duelOpponentPlacements'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const CASH_OUT_REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_MATCH_ID = '44444444-4444-4444-8444-444444444444'

const activeState = {
  matchId: MATCH_ID,
  role: 'A' as const,
  totalRounds: 3,
  participantCompleted: false,
  nextPlayableRoundNumber: 1,
  selfProgress: { completedRounds: 0, totalCapturedCoins: 0, threeCoinsComplete: 0 },
  activeRound: {
    roundNumber: 1,
    bagCount: 4,
    openedBags: [],
    provisionalCoins: 0 as const,
    nextOpenOrder: 1,
  },
  latestTerminalRound: null,
}

const opponentPlacements: DuelOpponentPlacementSet = {
  matchId: MATCH_ID,
  role: 'A',
  totalRounds: 3,
  formationVersion: 1,
  ruleVersion: 1,
  placements: [
    { roundNumber: 1, bagCount: 4, bombBagNumber: 4, coinBagNumbers: [1, 2, 2] },
    { roundNumber: 2, bagCount: 4, bombBagNumber: 4, coinBagNumbers: [1, 1, 1] },
    { roundNumber: 3, bagCount: 4, bombBagNumber: 4, coinBagNumbers: [1, 2, 3] },
  ],
}

function command(input: Omit<DuelOpenCommand, 'requestId'>): DuelOpenCommand {
  return { ...input, requestId: REQUEST_ID }
}

function cashOutCommand(
  input: Omit<DuelCashOutCommand, 'requestId'>,
): DuelCashOutCommand {
  return { ...input, requestId: CASH_OUT_REQUEST_ID }
}

const unusedCashOut = {
  createCashOutCommand: cashOutCommand,
  async cashOut() {
    throw new Error('cashOut should not run in this test')
  },
}

let placementGetCount = 0
const unusedPlacements = {
  async getOpponentPlacements() {
    placementGetCount += 1
    return opponentPlacements
  },
}

const unusedResult = {
  async getFinalResult() {
    throw new Error('getFinalResult should not run in this test')
  },
  async getMatchDetail() {
    throw new Error('getMatchDetail should not run in this test')
  },
}

assert.equal(isDuelPlayReady({
  matchId: MATCH_ID,
  self: { placementLocked: true },
  opponent: { placementLocked: true },
}, MATCH_ID), true)
assert.equal(isDuelPlayReady({
  matchId: MATCH_ID,
  self: { placementLocked: true },
  opponent: { placementLocked: false },
}, MATCH_ID), false)

const terminalFirst = selectDuelDisplayedRound({
  ...activeState,
  activeRound: { ...activeState.activeRound, roundNumber: 2 },
  nextPlayableRoundNumber: 2,
  latestTerminalRound: {
    roundNumber: 1,
    bagCount: 3,
    openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'bomb', coinsFound: 0 }],
    endReason: 'bombed',
    capturedCoins: 0,
    openedBagCount: 1,
  },
})
assert.equal(terminalFirst?.terminal, true)
assert.equal(terminalFirst?.roundNumber, 1)
assert.equal(canAdvanceDuelPlay({
  ...activeState,
  activeRound: { ...activeState.activeRound, roundNumber: 2 },
  nextPlayableRoundNumber: 2,
  latestTerminalRound: {
    roundNumber: 1,
    bagCount: 3,
    openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'bomb', coinsFound: 0 }],
    endReason: 'bombed',
    capturedCoins: 0,
    openedBagCount: 1,
  },
}), true)
assert.equal(canAdvanceDuelPlay({
  ...activeState,
  participantCompleted: true,
  nextPlayableRoundNumber: null,
  selfProgress: { completedRounds: 3, totalCapturedCoins: 0, threeCoinsComplete: 0 },
  activeRound: null,
  latestTerminalRound: {
    roundNumber: 3,
    bagCount: 3,
    openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'bomb', coinsFound: 0 }],
    endReason: 'bombed',
    capturedCoins: 0,
    openedBagCount: 1,
  },
}), false)

assert.equal(canOfferDuelCashOut({
  terminal: false,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [],
  provisionalCoins: 0,
  nextOpenOrder: 1,
}), false)
assert.equal(canOfferDuelCashOut({
  terminal: false,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
  provisionalCoins: 1,
  nextOpenOrder: 2,
}), true)
assert.equal(canOfferDuelCashOut({
  terminal: false,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [
    { bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 },
    { bagNumber: 2, openOrder: 2, outcome: 'coins', coinsFound: 1 },
  ],
  provisionalCoins: 2,
  nextOpenOrder: 3,
}), true)
assert.equal(canOfferDuelCashOut({
  terminal: true,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
  endReason: 'cashed_out',
  capturedCoins: 1,
  openedBagCount: 1,
}), false)

const revealPlan = buildDuelRevealPlan(
  {
    matchId: MATCH_ID,
    roundNumber: 1,
    bagCount: 3,
    bags: [
      { bagNumber: 1, contents: { kind: 'bomb' } },
      { bagNumber: 2, contents: { kind: 'coins', coinCount: 2 } },
      { bagNumber: 3, contents: { kind: 'coins', coinCount: 1 } },
    ],
  },
  [1],
)
assert.equal(revealPlan.bagCount, 3)
assert.equal(revealPlan.sprites.some((s) => s.kind === 'bomb'), false)
assert.equal(revealPlan.sprites.filter((s) => s.kind === 'coin').length, 3)
assert.ok(revealPlan.sprites.every((s) => s.bagId !== 'bag-1'))

let createCount = 0
let openCount = 0
let getCount = 0
let rejectOnce = true
const sent: DuelOpenCommand[] = []
const coordinator = createDuelPlayCoordinator({
  createOpenCommand(input) {
    createCount += 1
    return command(input)
  },
  ...unusedCashOut,
  ...unusedPlacements,
  ...unusedResult,
  async getPlayState() {
    getCount += 1
    return activeState
  },
  async getRoundReveal() {
    throw new Error('reveal should not run in open tests')
  },
  async openBag(value) {
    openCount += 1
    sent.push(value)
    if (rejectOnce) {
      rejectOnce = false
      throw new DuelPlayClientError('network')
    }
    return {
      matchId: MATCH_ID,
      roundNumber: 1,
      bagNumber: 1,
      openOrder: 1,
      outcome: 'empty',
      coinsFound: 0,
      provisionalCoins: 0,
      openedBagCount: 1,
      roundEnded: false,
      endReason: null,
      capturedCoins: null,
      participantCompleted: false,
    }
  },
})

const session = await coordinator.loadSession(MATCH_ID)
assert.equal(session.state, activeState)
assert.equal(session.opponentPlacements, opponentPlacements)
assert.equal(getCount, 1)
assert.deepEqual(
  coordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 1, bagCount: 4, bagNumber: 3,
  }),
  { outcome: 'empty', coinsFound: 0 },
)
assert.deepEqual(
  coordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 1, bagCount: 4, bagNumber: 4,
  }),
  { outcome: 'bomb', coinsFound: 0 },
)
assert.deepEqual(
  coordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 1, bagCount: 4, bagNumber: 2,
  }),
  { outcome: 'coins', coinsFound: 2 },
)
await coordinator.loadSession(MATCH_ID)
assert.equal(getCount, 2)
assert.equal(placementGetCount, 1)
assert.throws(
  () => coordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 1, bagCount: 5, bagNumber: 1,
  }),
  (error: unknown) => error instanceof DuelPlayCoordinatorError &&
    error.kind === 'session-unavailable',
)
assert.throws(
  () => coordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 4, bagCount: 4, bagNumber: 1,
  }),
  (error: unknown) => error instanceof DuelPlayCoordinatorError &&
    error.kind === 'session-unavailable',
)

let resolveOldPlacements!: (value: DuelOpponentPlacementSet) => void
const oldPlacements = new Promise<DuelOpponentPlacementSet>((resolve) => {
  resolveOldPlacements = resolve
})
const otherState = { ...activeState, matchId: OTHER_MATCH_ID }
const otherPlacements: DuelOpponentPlacementSet = {
  ...opponentPlacements,
  matchId: OTHER_MATCH_ID,
  placements: opponentPlacements.placements.map((placement) => ({ ...placement })),
}
const switchingCoordinator = createDuelPlayCoordinator({
  createOpenCommand: command,
  ...unusedCashOut,
  ...unusedResult,
  async getPlayState(id) { return id === MATCH_ID ? activeState : otherState },
  async getOpponentPlacements(id) {
    return id === MATCH_ID ? oldPlacements : otherPlacements
  },
  async openBag() { throw new Error('unused') },
  async getRoundReveal() { throw new Error('unused') },
})
const staleLoad = switchingCoordinator.loadSession(MATCH_ID)
await Promise.resolve()
const currentLoad = switchingCoordinator.loadSession(OTHER_MATCH_ID)
assert.equal((await currentLoad).opponentPlacements.matchId, OTHER_MATCH_ID)
resolveOldPlacements(opponentPlacements)
await assert.rejects(
  staleLoad,
  (error: unknown) => error instanceof DuelPlayCoordinatorError &&
    error.kind === 'session-unavailable',
)
assert.deepEqual(
  switchingCoordinator.getLocalOpenResult({
    matchId: OTHER_MATCH_ID, roundNumber: 1, bagCount: 4, bagNumber: 4,
  }),
  { outcome: 'bomb', coinsFound: 0 },
)
assert.throws(
  () => switchingCoordinator.getLocalOpenResult({
    matchId: MATCH_ID, roundNumber: 1, bagCount: 4, bagNumber: 4,
  }),
  DuelPlayCoordinatorError,
)

await assert.rejects(
  () => coordinator.open({
    matchId: MATCH_ID, roundNumber: 1, bagNumber: 1, expectedOpenOrder: 1,
  }),
  (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
)
assert.equal(createCount, 1)
assert.equal(openCount, 1)
const pending = coordinator.getPendingOpen()
assert.ok(pending)
assert.equal(pending.requestId, REQUEST_ID)

await assert.rejects(
  () => coordinator.open({
    matchId: MATCH_ID, roundNumber: 1, bagNumber: 2, expectedOpenOrder: 1,
  }),
  (error: unknown) => error instanceof DuelPlayCoordinatorError && error.kind === 'retry-required',
)

const opened = await coordinator.open({
  matchId: MATCH_ID, roundNumber: 1, bagNumber: 1, expectedOpenOrder: 1,
})
assert.equal(opened.kind, 'opened')
assert.equal(openCount, 2)
assert.equal(createCount, 1)
assert.equal(coordinator.getPendingOpen(), null)
assert.deepEqual(sent[0], sent[1])

let conflictGetCount = 0
const conflictCoordinator = createDuelPlayCoordinator({
  createOpenCommand: command,
  ...unusedCashOut,
  ...unusedPlacements,
  ...unusedResult,
  async openBag() { throw new DuelPlayClientError('conflict') },
  async getPlayState() { conflictGetCount += 1; return activeState },
  async getRoundReveal() { throw new Error('unused') },
})
const resynced = await conflictCoordinator.open({
  matchId: MATCH_ID, roundNumber: 1, bagNumber: 1, expectedOpenOrder: 1,
})
assert.equal(resynced.kind, 'resynced')
assert.equal(conflictGetCount, 1)

let revealCalls = 0
const revealCoordinator = createDuelPlayCoordinator({
  createOpenCommand: command,
  ...unusedCashOut,
  ...unusedPlacements,
  ...unusedResult,
  async openBag() { throw new Error('unused') },
  async getPlayState() { return activeState },
  async getRoundReveal(id, roundNumber) {
    revealCalls += 1
    assert.equal(id, MATCH_ID)
    assert.equal(roundNumber, 1)
    return {
      matchId: MATCH_ID,
      roundNumber: 1,
      bagCount: 3,
      bags: [
        { bagNumber: 1, contents: { kind: 'empty' } },
        { bagNumber: 2, contents: { kind: 'bomb' } },
        { bagNumber: 3, contents: { kind: 'coins', coinCount: 3 } },
      ],
    }
  },
})
const reveal = await revealCoordinator.getRoundReveal(MATCH_ID, 1)
assert.equal(reveal.roundNumber, 1)
assert.equal(revealCalls, 1)

let cashOutCreateCount = 0
let cashOutCallCount = 0
const cashOutSent: DuelCashOutCommand[] = []
let cashOutRejectOnce = true
const cashOutCoordinator = createDuelPlayCoordinator({
  createOpenCommand: command,
  ...unusedResult,
  ...unusedPlacements,
  createCashOutCommand(input) {
    cashOutCreateCount += 1
    return cashOutCommand(input)
  },
  async openBag() { throw new Error('open should not run in cash-out tests') },
  async getPlayState() { return activeState },
  async getRoundReveal() { throw new Error('unused') },
  async cashOut(value) {
    cashOutCallCount += 1
    cashOutSent.push(value)
    if (cashOutRejectOnce) {
      cashOutRejectOnce = false
      throw new DuelPlayClientError('network')
    }
    return {
      matchId: MATCH_ID,
      roundNumber: 1,
      endReason: 'cashed_out' as const,
      capturedCoins: 1 as const,
      openedBagCount: 1,
      participantCompleted: false,
    }
  },
})

await assert.rejects(
  () => cashOutCoordinator.cashOut({ matchId: MATCH_ID, roundNumber: 1 }),
  (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
)
assert.equal(cashOutCreateCount, 1)
assert.equal(cashOutCallCount, 1)

await assert.rejects(
  () => cashOutCoordinator.cashOut({ matchId: MATCH_ID, roundNumber: 2 }),
  (error: unknown) => error instanceof DuelPlayCoordinatorError && error.kind === 'retry-required',
)

const cashedOut = await cashOutCoordinator.cashOut({ matchId: MATCH_ID, roundNumber: 1 })
assert.equal(cashedOut.kind, 'cashed-out')
assert.equal(cashedOut.result.endReason, 'cashed_out')
assert.equal(cashedOut.result.capturedCoins, 1)
assert.equal(cashOutCreateCount, 1)
assert.equal(cashOutCallCount, 2)
assert.deepEqual(cashOutSent[0], cashOutSent[1])

let cashOutConflictGet = 0
const cashOutConflictCoordinator = createDuelPlayCoordinator({
  createOpenCommand: command,
  ...unusedResult,
  ...unusedPlacements,
  createCashOutCommand: cashOutCommand,
  async openBag() { throw new Error('unused') },
  async cashOut() { throw new DuelPlayClientError('conflict') },
  async getPlayState() {
    cashOutConflictGet += 1
    return {
      ...activeState,
      activeRound: null,
      latestTerminalRound: {
        roundNumber: 1,
        bagCount: 4,
        openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
        endReason: 'cashed_out' as const,
        capturedCoins: 1,
        openedBagCount: 1,
      },
    }
  },
  async getRoundReveal() { throw new Error('unused') },
})
const cashOutResynced = await cashOutConflictCoordinator.cashOut({
  matchId: MATCH_ID,
  roundNumber: 1,
})
assert.equal(cashOutResynced.kind, 'resynced')
assert.equal(cashOutConflictGet, 1)
assert.equal(cashOutResynced.state.latestTerminalRound?.endReason, 'cashed_out')

/* --- CASH OUT + pendingOpen recovery regressions --- */

function oneCoinActiveState(openedBagCount: 1 | 2) {
  const openedBags = Array.from({ length: openedBagCount }, (_, index) => ({
    bagNumber: index + 1,
    openOrder: index + 1,
    outcome: 'coins' as const,
    coinsFound: 1 as const,
  }))
  return {
    ...activeState,
    activeRound: {
      roundNumber: 1,
      bagCount: 4,
      openedBags,
      provisionalCoins: openedBagCount as 1 | 2,
      nextOpenOrder: openedBagCount + 1,
    },
    latestTerminalRound: null,
  }
}

{
  let openCalls = 0
  let cashCalls = 0
  let getCalls = 0
  let openRejectOnce = true
  const recoveryCoordinator = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag(value) {
      openCalls += 1
      assert.equal(value.requestId, REQUEST_ID)
      assert.equal(value.bagNumber, 1)
      if (openRejectOnce) {
        openRejectOnce = false
        throw new DuelPlayClientError('network')
      }
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        bagNumber: 1,
        openOrder: 1,
        outcome: 'coins' as const,
        coinsFound: 1 as const,
        provisionalCoins: 1 as const,
        openedBagCount: 1,
        roundEnded: false as const,
        endReason: null,
        capturedCoins: null,
        participantCompleted: false,
      }
    },
    async cashOut(value) {
      cashCalls += 1
      assert.equal(value.roundNumber, 1)
      assert.equal(value.requestId, CASH_OUT_REQUEST_ID)
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        endReason: 'cashed_out' as const,
        capturedCoins: 1 as const,
        openedBagCount: 1,
        participantCompleted: false,
      }
    },
    async getPlayState() {
      getCalls += 1
      if (cashCalls === 0) return oneCoinActiveState(1)
      return {
        ...activeState,
        activeRound: {
          roundNumber: 2,
          bagCount: 4,
          openedBags: [],
          provisionalCoins: 0 as const,
          nextOpenOrder: 1,
        },
        latestTerminalRound: {
          roundNumber: 1,
          bagCount: 4,
          openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
          endReason: 'cashed_out' as const,
          capturedCoins: 1,
          openedBagCount: 1,
        },
        nextPlayableRoundNumber: 2,
        selfProgress: { completedRounds: 1, totalCapturedCoins: 1, threeCoinsComplete: 0 },
      }
    },
    async getRoundReveal() { throw new Error('unused') },
  })

  await assert.rejects(
    () => recoveryCoordinator.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 1, expectedOpenOrder: 1,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  assert.ok(recoveryCoordinator.getPendingOpen())
  assert.equal(recoveryCoordinator.hasUnresolvedPlayCommand(), true)

  await assert.rejects(
    () => recoveryCoordinator.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 2, expectedOpenOrder: 1,
    }),
    (error: unknown) => error instanceof DuelPlayCoordinatorError && error.kind === 'retry-required',
  )
  assert.ok(recoveryCoordinator.getPendingOpen())

  const recovered = await recoveryCoordinator.cashOut({ matchId: MATCH_ID, roundNumber: 1 })
  assert.equal(recovered.kind, 'resynced')
  assert.equal(recovered.state.latestTerminalRound?.endReason, 'cashed_out')
  assert.equal(recovered.state.latestTerminalRound?.capturedCoins, 1)
  assert.equal(openCalls, 2)
  assert.equal(cashCalls, 1)
  assert.ok(getCalls >= 2)
  assert.equal(recoveryCoordinator.getPendingOpen(), null)
  assert.equal(recoveryCoordinator.hasUnresolvedPlayCommand(), false)
  assert.equal(canOfferDuelCashOut(selectDuelDisplayedRound(recovered.state)!), false)
  assert.equal(selectDuelDisplayedRound(recovered.state)?.terminal, true)
  assert.equal(canAdvanceDuelPlay(recovered.state), true)
}

{
  let openCalls = 0
  let cashCalls = 0
  let openRejectOnce = true
  const twoCoinRecovery = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag(value) {
      openCalls += 1
      if (openRejectOnce) {
        openRejectOnce = false
        throw new DuelPlayClientError('network')
      }
      assert.equal(value.bagNumber, 2)
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        bagNumber: 2,
        openOrder: 2,
        outcome: 'coins' as const,
        coinsFound: 1 as const,
        provisionalCoins: 2 as const,
        openedBagCount: 2,
        roundEnded: false as const,
        endReason: null,
        capturedCoins: null,
        participantCompleted: false,
      }
    },
    async cashOut() {
      cashCalls += 1
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        endReason: 'cashed_out' as const,
        capturedCoins: 2 as const,
        openedBagCount: 2,
        participantCompleted: false,
      }
    },
    async getPlayState() {
      if (cashCalls === 0) return oneCoinActiveState(2)
      return {
        ...activeState,
        activeRound: {
          roundNumber: 2,
          bagCount: 4,
          openedBags: [],
          provisionalCoins: 0 as const,
          nextOpenOrder: 1,
        },
        latestTerminalRound: {
          roundNumber: 1,
          bagCount: 4,
          openedBags: [
            { bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 },
            { bagNumber: 2, openOrder: 2, outcome: 'coins', coinsFound: 1 },
          ],
          endReason: 'cashed_out' as const,
          capturedCoins: 2,
          openedBagCount: 2,
        },
        nextPlayableRoundNumber: 2,
      }
    },
    async getRoundReveal() { throw new Error('unused') },
  })
  await assert.rejects(
    () => twoCoinRecovery.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 2, expectedOpenOrder: 2,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  const twoRecovered = await twoCoinRecovery.cashOut({ matchId: MATCH_ID, roundNumber: 1 })
  assert.equal(twoRecovered.kind, 'resynced')
  assert.equal(twoRecovered.state.latestTerminalRound?.capturedCoins, 2)
  assert.equal(openCalls, 2)
  assert.equal(cashCalls, 1)
}

{
  let cashCalls = 0
  let openRejectOnce = true
  const bombRecovery = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag() {
      if (openRejectOnce) {
        openRejectOnce = false
        throw new DuelPlayClientError('network')
      }
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        bagNumber: 4,
        openOrder: 1,
        outcome: 'bomb' as const,
        coinsFound: 0 as const,
        provisionalCoins: 0 as const,
        openedBagCount: 1,
        roundEnded: true as const,
        endReason: 'bombed' as const,
        capturedCoins: 0 as const,
        participantCompleted: false,
      }
    },
    async cashOut() {
      cashCalls += 1
      throw new Error('cashOut must not run after bomb terminal')
    },
    async getPlayState() {
      return {
        ...activeState,
        activeRound: {
          roundNumber: 2,
          bagCount: 4,
          openedBags: [],
          provisionalCoins: 0 as const,
          nextOpenOrder: 1,
        },
        latestTerminalRound: {
          roundNumber: 1,
          bagCount: 4,
          openedBags: [{ bagNumber: 4, openOrder: 1, outcome: 'bomb', coinsFound: 0 }],
          endReason: 'bombed' as const,
          capturedCoins: 0,
          openedBagCount: 1,
        },
        nextPlayableRoundNumber: 2,
      }
    },
    async getRoundReveal() { throw new Error('unused') },
  })
  await assert.rejects(
    () => bombRecovery.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 4, expectedOpenOrder: 1,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  const bombed = await bombRecovery.cashOut({ matchId: MATCH_ID, roundNumber: 1 })
  assert.equal(bombed.kind, 'resynced')
  assert.equal(bombed.state.latestTerminalRound?.endReason, 'bombed')
  assert.equal(cashCalls, 0)
  assert.equal(canOfferDuelCashOut(selectDuelDisplayedRound(bombed.state)!), false)
}

{
  let cashCalls = 0
  let openRejectOnce = true
  const clearedRecovery = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag() {
      if (openRejectOnce) {
        openRejectOnce = false
        throw new DuelPlayClientError('network')
      }
      return {
        matchId: MATCH_ID,
        roundNumber: 1,
        bagNumber: 3,
        openOrder: 3,
        outcome: 'coins' as const,
        coinsFound: 1 as const,
        provisionalCoins: 3 as const,
        openedBagCount: 3,
        roundEnded: true as const,
        endReason: 'cleared' as const,
        capturedCoins: 3 as const,
        participantCompleted: false,
      }
    },
    async cashOut() {
      cashCalls += 1
      throw new Error('cashOut must not run after cleared terminal')
    },
    async getPlayState() {
      return {
        ...activeState,
        activeRound: {
          roundNumber: 2,
          bagCount: 4,
          openedBags: [],
          provisionalCoins: 0 as const,
          nextOpenOrder: 1,
        },
        latestTerminalRound: {
          roundNumber: 1,
          bagCount: 4,
          openedBags: [
            { bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 },
            { bagNumber: 2, openOrder: 2, outcome: 'coins', coinsFound: 1 },
            { bagNumber: 3, openOrder: 3, outcome: 'coins', coinsFound: 1 },
          ],
          endReason: 'cleared' as const,
          capturedCoins: 3,
          openedBagCount: 3,
        },
        nextPlayableRoundNumber: 2,
      }
    },
    async getRoundReveal() { throw new Error('unused') },
  })
  await assert.rejects(
    () => clearedRecovery.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 3, expectedOpenOrder: 3,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  const cleared = await clearedRecovery.cashOut({ matchId: MATCH_ID, roundNumber: 1 })
  assert.equal(cleared.kind, 'resynced')
  assert.equal(cleared.state.latestTerminalRound?.endReason, 'cleared')
  assert.equal(cashCalls, 0)
}

{
  let cashCalls = 0
  let openRejectOnce = true
  const finalRoundCashOut = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag() {
      if (openRejectOnce) {
        openRejectOnce = false
        throw new DuelPlayClientError('network')
      }
      return {
        matchId: MATCH_ID,
        roundNumber: 3,
        bagNumber: 1,
        openOrder: 1,
        outcome: 'coins' as const,
        coinsFound: 1 as const,
        provisionalCoins: 1 as const,
        openedBagCount: 1,
        roundEnded: false as const,
        endReason: null,
        capturedCoins: null,
        participantCompleted: false,
      }
    },
    async cashOut() {
      cashCalls += 1
      return {
        matchId: MATCH_ID,
        roundNumber: 3,
        endReason: 'cashed_out' as const,
        capturedCoins: 1 as const,
        openedBagCount: 1,
        participantCompleted: true,
      }
    },
    async getPlayState() {
      if (cashCalls === 0) {
        return {
          ...activeState,
          totalRounds: 3,
          nextPlayableRoundNumber: 3,
          activeRound: {
            roundNumber: 3,
            bagCount: 4,
            openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
            provisionalCoins: 1 as const,
            nextOpenOrder: 2,
          },
          latestTerminalRound: null,
          selfProgress: { completedRounds: 2, totalCapturedCoins: 2, threeCoinsComplete: 0 },
        }
      }
      return {
        ...activeState,
        totalRounds: 3,
        participantCompleted: true,
        nextPlayableRoundNumber: null,
        activeRound: null,
        latestTerminalRound: {
          roundNumber: 3,
          bagCount: 4,
          openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
          endReason: 'cashed_out' as const,
          capturedCoins: 1,
          openedBagCount: 1,
        },
        selfProgress: { completedRounds: 3, totalCapturedCoins: 3, threeCoinsComplete: 0 },
      }
    },
    async getRoundReveal() { throw new Error('unused') },
  })
  await assert.rejects(
    () => finalRoundCashOut.open({
      matchId: MATCH_ID, roundNumber: 3, bagNumber: 1, expectedOpenOrder: 1,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  const finalRecovered = await finalRoundCashOut.cashOut({ matchId: MATCH_ID, roundNumber: 3 })
  assert.equal(finalRecovered.kind, 'resynced')
  assert.equal(finalRecovered.state.latestTerminalRound?.endReason, 'cashed_out')
  assert.equal(finalRecovered.state.participantCompleted, true)
  assert.equal(canAdvanceDuelPlay(finalRecovered.state), false)
  assert.equal(cashCalls, 1)
}

{
  const failedRecovery = createDuelPlayCoordinator({
    createOpenCommand: command,
    ...unusedPlacements,
    ...unusedResult,
    createCashOutCommand: cashOutCommand,
    async openBag() {
      throw new DuelPlayClientError('network')
    },
    async cashOut() {
      throw new Error('cashOut must not run while open retry fails')
    },
    async getPlayState() { return oneCoinActiveState(1) },
    async getRoundReveal() { throw new Error('unused') },
  })
  await assert.rejects(
    () => failedRecovery.open({
      matchId: MATCH_ID, roundNumber: 1, bagNumber: 1, expectedOpenOrder: 1,
    }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  await assert.rejects(
    () => failedRecovery.cashOut({ matchId: MATCH_ID, roundNumber: 1 }),
    (error: unknown) => error instanceof DuelPlayClientError && error.kind === 'network',
  )
  assert.ok(failedRecovery.getPendingOpen())
  assert.equal(failedRecovery.hasUnresolvedPlayCommand(), true)
}

assert.equal(canOfferDuelCashOut({
  terminal: false,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
  provisionalCoins: 1,
  nextOpenOrder: 2,
}), true)
assert.equal(canOfferDuelCashOut({
  terminal: false,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [
    { bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 },
    { bagNumber: 2, openOrder: 2, outcome: 'coins', coinsFound: 1 },
  ],
  provisionalCoins: 2,
  nextOpenOrder: 3,
}), true)
assert.equal(canOfferDuelCashOut({
  terminal: true,
  roundNumber: 1,
  bagCount: 4,
  openedBags: [{ bagNumber: 1, openOrder: 1, outcome: 'coins', coinsFound: 1 }],
  endReason: 'cashed_out',
  capturedCoins: 1,
  openedBagCount: 1,
}), false)

const [screen, flow, invite, coordinatorSource, bagBoard, bagCss] = await Promise.all([
  readFile(new URL('../src/components/DuelPlayScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/DuelFlow.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/DuelInvitePanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/duel/duelPlayCoordinator.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/BagBoard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/BagBoard.css', import.meta.url), 'utf8'),
])
for (const required of [
  'createDuelPlayClient', 'createDuelPlayCoordinator', 'BagBoard', 'CoinOpenFx',
  'BombOpenFx', 'EmptyOpenFx', 'RevealBoard', 'selectDuelDisplayedRound',
  'buildDuelRevealPlan', 'canAdvanceDuelPlay', 'canOfferDuelCashOut', 'getRoundReveal',
  'coordinator.cashOut', 'result.outcome', 'result.coinsFound', 'end-actions',
  'cash-out-btn', 't.cashOut', 't.reveal', 't.nextRound', 't.duelCashOutRetry',
]) assert.match(screen, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(screen, /duel-play-result/)
assert.doesNotMatch(screen, /t\.roundBombed/)
assert.doesNotMatch(screen, /t\.roundCleared/)
assert.doesNotMatch(screen, /t\.roundCashedOut/)
assert.doesNotMatch(screen, /t\.provisionalCoins\(/)
assert.match(screen, /getLocalOpenResult/)
assert.match(screen, /startPredictedOpenFx/)
assert.match(screen, /createOptimisticOpenGate|markOptimisticFxDone|markOptimisticServerDone/)
assert.match(screen, /sameLocalAndServerOpen/)
assert.match(screen, /coordinator\.loadSession\(matchId\)/)
assert.match(screen, /coordinator\.getPendingOpen\(\)/)
assert.match(screen, /getPendingCashOut\(\)/)
assert.match(screen, /cashOutError/)
assert.match(screen, /setCashOutError\(true\)/)
assert.doesNotMatch(screen, /openingBagId|setOpeningBagId/)
assert.doesNotMatch(screen, /pendingBagId|setPendingBagId/)
assert.match(screen, /interactionLockedRef\.current = true[\s\S]*setRequestPending\(true\)[\s\S]*await coordinator\.open/)
assert.match(screen, /catch \{[\s\S]*setRetryBag\(bagId\)/)
assert.match(
  screen,
  /const unresolvedOpen = coordinator\.getPendingOpen\(\)[\s\S]*startPredictedOpenFx/,
)
assert.match(
  screen,
  /handleCashOut[\s\S]*catch \{[\s\S]*setCashOutError\(true\)/,
)
assert.doesNotMatch(
  screen,
  /handleCashOut[\s\S]*catch \{\s*interactionLockedRef\.current = false\s*setRetryBag\(null\)\s*\}/,
)
assert.match(screen, /view\.selfProgress\.completedRounds/)
assert.match(screen, /view\.selfProgress\.totalCapturedCoins/)
assert.match(screen, /view\.selfProgress\.threeCoinsComplete/)
assert.match(screen, /3COINS COMPLETE/)
assert.match(screen, /score-row--secondary/)
const appCss = await readFile('src/App.css', 'utf8')
assert.match(appCss, /\.score-stack/)
assert.match(appCss, /\.score-stack\s*{[^}]*align-items:\s*stretch/s)
assert.match(appCss, /\.score-row\s*{[^}]*justify-content:\s*center/s)
assert.match(appCss, /\.score-row\s*{[^}]*width:\s*max-content/s)
assert.match(appCss, /\.score-row--secondary\s*{[^}]*width:\s*0/s)
assert.match(appCss, /\.score-row--secondary\s*{[^}]*min-width:\s*100%/s)
assert.match(appCss, /\.score-row--secondary\s*{[^}]*justify-content:\s*flex-start/s)
assert.match(appCss, /\.score-row--secondary \.score-item\s*{[^}]*justify-content:\s*flex-start/s)
assert.match(appCss, /--duel-score-pair-gap:\s*0\.45rem/)
assert.match(appCss, /--duel-score-group-gap:\s*1\.15rem/)
assert.match(appCss, /\.duel-play \.score-item\s*{[^}]*gap:\s*var\(--duel-score-pair-gap\)/s)
assert.match(appCss, /\.duel-play \.score-row\s*{[^}]*column-gap:\s*var\(--duel-score-group-gap\)/s)
assert.match(appCss, /\.duel-play \.score-num\s*{[^}]*min-width:\s*0/s)
assert.match(appCss, /\.duel-play \.score-num\s*{[^}]*text-align:\s*left/s)
assert.match(appCss, /\.score-num\s*{[^}]*font-family:\s*[\s\S]*?system-ui/s)
assert.match(appCss, /\.score-num\s*{[^}]*font-variant-numeric:\s*tabular-nums/s)
assert.doesNotMatch(
  appCss,
  /\.duel-play \.score-row > \.score-item:first-child \.score-num\s*{[^}]*min-width:\s*7\.5ch/s,
)
assert.match(appCss, /\.score-label\s*{[^}]*font-family:\s*Georgia/s)
assert.match(appCss, /\.score-label\s*{[^}]*font-variant-numeric:\s*lining-nums/s)
assert.match(
  screen,
  /<span className="score-label">3COINS COMPLETE<\/span>\s*<span className="score-num">/,
  '3COINS COMPLETE must be one score-label followed by the value score-num',
)
assert.doesNotMatch(
  screen,
  /score-label">3\s*<span/,
  'leading 3 must not be split into its own span',
)
assert.match(appCss, /\.duel-final-stat/)
assert.match(appCss, /\.duel-final-stats\s*{/)
assert.match(appCss, /\.duel-final\s*{[^}]*width:\s*min\(100%,\s*30rem\)/s)
assert.match(appCss, /\.duel-final-player\s*{[^}]*width:\s*15\.25rem/s)
assert.match(appCss, /\.duel-final-scores\s*{[^}]*max-content/s)
assert.match(appCss, /--duel-button-field-h:\s*9\.35rem/)
assert.doesNotMatch(appCss, /14\.74vh/)
assert.match(screen, /if \(result\.roundEnded\) refreshSelfProgress\(\)/)
assert.match(screen, /visualHiddenBagIds\(opened, coinFxSample\)/)
assert.match(screen, /const next = new Set\(opened\)[\s\S]*next\.delete\(fx\.bagId\)/)
assert.match(screen, /onSample=\{setCoinFxSample\}/)
assert.match(bagBoard, /hiddenBagIds\?\.has\(slot\.bagId\)/)
assert.doesNotMatch(bagBoard, /openingBagId/)
assert.doesNotMatch(bagBoard, /bag-slot--opening/)
assert.doesNotMatch(bagCss, /bag-slot--opening/)
assert.doesNotMatch(bagBoard, /pendingBagId|bag-image--pending/)
assert.doesNotMatch(bagCss, /bag-image--pending|scale\(0\.985\)|transform-origin: 50% 62%|transition: transform 100ms ease-out/)
assert.doesNotMatch(screen, /Math\.random/)
// Optimistic path: predicted FX/SE before awaiting server; no second FX after response.
const optimisticOpen = screen.match(
  /if \(local\) \{[\s\S]*?return\n    \}/,
)?.[0] ?? ''
assert.ok(optimisticOpen.includes('startPredictedOpenFx'))
assert.ok(optimisticOpen.indexOf('startPredictedOpenFx') < optimisticOpen.indexOf('await coordinator.open'))
assert.doesNotMatch(optimisticOpen, /await coordinator\.open[\s\S]*startPredictedOpenFx/)
assert.doesNotMatch(optimisticOpen, /await coordinator\.open[\s\S]*playBagOpen/)
assert.doesNotMatch(optimisticOpen, /await coordinator\.open[\s\S]*setFx\(\{/)
// Unresolved pendingOpen/pendingCashOut must be gated before predicted FX.
const bagTap = screen.match(
  /const handleBagTap = useCallback\(async \(bagId: BagId\) => \{[\s\S]*?\n  \}, \[/,
)?.[0] ?? ''
assert.ok(bagTap.includes('getPendingOpen()'))
assert.ok(bagTap.indexOf('getPendingOpen()') < bagTap.indexOf('startPredictedOpenFx'))
assert.ok(bagTap.indexOf('getPendingCashOut()') < bagTap.indexOf('startPredictedOpenFx'))
// Server-first fallback still mounts FX from authoritative result only.
const fallbackOpen = screen.match(
  /const result = outcome\.result\n      const nextRound = appendOpen\(round, result\)[\s\S]*?if \(result\.roundEnded\) refreshSelfProgress\(\)/,
)?.[0] ?? ''
assert.ok(fallbackOpen.includes('setFx({'))
assert.ok(fallbackOpen.indexOf('appendOpen') < fallbackOpen.indexOf('playBagOpen'))
assert.equal((fallbackOpen.match(/setFx\(/g) ?? []).length, 3)
assert.match(coordinatorSource, /latestTerminalRound/)
assert.match(coordinatorSource, /activeRound/)
assert.match(coordinatorSource, /buildDuelRevealPlan/)
assert.match(coordinatorSource, /canAdvanceDuelPlay/)
assert.match(coordinatorSource, /canOfferDuelCashOut/)
assert.match(coordinatorSource, /getRoundReveal/)
assert.match(coordinatorSource, /createCashOutCommand/)
assert.match(coordinatorSource, /async cashOut\(/)
assert.match(coordinatorSource, /kind: 'cashed-out'/)
assert.match(coordinatorSource, /hasUnresolvedPlayCommand/)
assert.match(coordinatorSource, /settledPendingOpen/)
assert.match(coordinatorSource, /canOfferDuelCashOut\(displayed\)/)
assert.match(coordinatorSource, /await client\.openBag\(pendingOpen\)/)
assert.doesNotMatch(coordinatorSource, /if \(pendingOpen\) throw new DuelPlayCoordinatorError\('retry-required'\)/)
for (const forbidden of [
  'applyOpenBag', 'createActiveRound', 'HiddenHand', 'tryCashOut',
  'lastAcknowledgedTerminalRound', 'setInterval',
]) assert.doesNotMatch(screen, new RegExp(forbidden.replace(/[()]/g, '\\$&')))
assert.doesNotMatch(coordinatorSource, /lastAcknowledgedTerminalRound/)
assert.doesNotMatch(coordinatorSource, /tryCashOut/)
assert.match(flow, /DuelPlayScreen/)
assert.match(invite, /isDuelPlayReady/)
assert.match(invite, /visibilitychange/)
assert.match(invite, /DUEL_READY_POLL_INTERVAL_MS = 5_000/)
assert.match(invite, /window\.setInterval/)
assert.match(invite, /document\.visibilityState === 'visible'/)
assert.match(invite, /window\.clearInterval\(pollTimer\)/)
assert.match(invite, /if \(!active \|\| refreshPending\) return/)
// Start-confirm: keep polling until playReady AND matchMeta are both settled.
assert.match(invite, /const pollSettled = playReady && matchMeta != null/)
assert.match(invite, /if \(!storage \|\| pollSettled\) return/)
assert.match(invite, /}, \[storage, matchId, pollSettled\]\)/)
assert.doesNotMatch(invite, /if \(!storage \|\| playReady\) return/)
assert.doesNotMatch(coordinatorSource, /localStorage|sessionStorage|Math\.random/)
assert.match(coordinatorSource, /judgeDuelOpponentBag/)
assert.match(coordinatorSource, /opponentPlacements/)
assert.equal(getCount, 2)

console.log('DUEL play screen verification passed.')
