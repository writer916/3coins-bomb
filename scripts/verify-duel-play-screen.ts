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

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const CASH_OUT_REQUEST_ID = '33333333-3333-4333-8333-333333333333'

const activeState = {
  matchId: MATCH_ID,
  role: 'A' as const,
  totalRounds: 3,
  participantCompleted: false,
  nextPlayableRoundNumber: 1,
  selfProgress: { completedRounds: 0, totalCapturedCoins: 0 },
  activeRound: {
    roundNumber: 1,
    bagCount: 4,
    openedBags: [],
    provisionalCoins: 0 as const,
    nextOpenOrder: 1,
  },
  latestTerminalRound: null,
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

const unusedResult = {
  async getFinalResult() {
    throw new Error('getFinalResult should not run in this test')
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
  selfProgress: { completedRounds: 3, totalCapturedCoins: 0 },
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
  'cash-out-btn', 't.cashOut', 't.reveal', 't.nextRound',
]) assert.match(screen, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(screen, /duel-play-result/)
assert.doesNotMatch(screen, /t\.roundBombed/)
assert.doesNotMatch(screen, /t\.roundCleared/)
assert.doesNotMatch(screen, /t\.roundCashedOut/)
assert.doesNotMatch(screen, /t\.provisionalCoins\(/)
assert.match(screen, /setOpeningBagId\(bagId\)[\s\S]*playBagOpen[\s\S]*await coordinator\.open/)
assert.match(screen, /const clearFx = useCallback\(\(\) => \{[\s\S]*setOpeningBagId\(null\)[\s\S]*setFx\(null\)/)
assert.match(screen, /Keep openingBagId until FX completes/)
assert.match(screen, /catch \{[\s\S]*setOpeningBagId\(null\)[\s\S]*setRetryBag\(bagId\)/)
assert.match(screen, /openingBagId=\{openingBagId\}/)
assert.match(screen, /view\.selfProgress\.completedRounds/)
assert.match(screen, /view\.selfProgress\.totalCapturedCoins/)
assert.match(screen, /if \(result\.roundEnded\) refreshSelfProgress\(\)/)
assert.match(bagBoard, /hiddenBagIds\?\.has\(slot\.bagId\) \|\| openingBagId === slot\.bagId/)
assert.doesNotMatch(bagBoard, /bag-slot--opening/)
assert.doesNotMatch(bagCss, /bag-slot--opening/)
assert.doesNotMatch(screen, /visualHiddenBagIds|fxSample/)
assert.doesNotMatch(screen, /Math\.random/)
// Success path must not clear temporary hide before authoritative FX starts.
const successOpen = screen.match(
  /const result = outcome\.result[\s\S]*?if \(result\.roundEnded\) refreshSelfProgress\(\)/,
)?.[0] ?? ''
assert.ok(successOpen.includes('setFx({'))
assert.ok(!successOpen.includes('setOpeningBagId(null)'))
assert.match(coordinatorSource, /latestTerminalRound/)
assert.match(coordinatorSource, /activeRound/)
assert.match(coordinatorSource, /buildDuelRevealPlan/)
assert.match(coordinatorSource, /canAdvanceDuelPlay/)
assert.match(coordinatorSource, /canOfferDuelCashOut/)
assert.match(coordinatorSource, /getRoundReveal/)
assert.match(coordinatorSource, /createCashOutCommand/)
assert.match(coordinatorSource, /async cashOut\(/)
assert.match(coordinatorSource, /kind: 'cashed-out'/)
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
assert.match(invite, /if \(!storage \|\| playReady\) return/)
assert.doesNotMatch(coordinatorSource, /localStorage|sessionStorage|Math\.random/)
assert.equal(getCount, 0)

console.log('DUEL play screen verification passed.')
