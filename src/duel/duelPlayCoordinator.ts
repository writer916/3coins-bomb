import type { BagCount } from '../game/formations'
import { bagDepthZIndex, getFormation } from '../game/formations'
import {
  REVEAL_COIN_STACK_OFFSETS,
  type RevealPlan,
  type RevealSprite,
} from '../game/reveal'
import {
  bagNumberToBagId,
  DuelPlayClientError,
  type DuelCashOutCommand,
  type DuelCashOutResult,
  type DuelOpenCommand,
  type DuelOpenResult,
  type DuelActiveRound,
  type DuelPlayState,
  type DuelRoundReveal,
  type DuelFinalResult,
  type DuelMatchDetail,
  type DuelTerminalRound,
  type createDuelPlayClient,
} from './duelPlayClient'
import {
  judgeDuelOpponentBag,
  type DuelLocalOpenResult,
  type DuelOpponentPlacementSet,
} from './duelOpponentPlacements'

type DuelPlayClient = Pick<
  ReturnType<typeof createDuelPlayClient>,
  | 'createOpenCommand'
  | 'createCashOutCommand'
  | 'getPlayState'
  | 'getOpponentPlacements'
  | 'openBag'
  | 'cashOut'
  | 'getRoundReveal'
  | 'getFinalResult'
  | 'getMatchDetail'
>

export class DuelPlayCoordinatorError extends Error {
  readonly kind: 'busy' | 'retry-required' | 'session-unavailable'

  constructor(kind: 'busy' | 'retry-required' | 'session-unavailable') {
    super('The DUEL play action could not be completed.')
    this.name = 'DuelPlayCoordinatorError'
    this.kind = kind
  }
}

export type DuelOpenCoordinatorResult =
  | { readonly kind: 'opened'; readonly result: DuelOpenResult }
  | { readonly kind: 'resynced'; readonly state: DuelPlayState }

export type DuelCashOutCoordinatorResult =
  | { readonly kind: 'cashed-out'; readonly result: DuelCashOutResult }
  | { readonly kind: 'resynced'; readonly state: DuelPlayState }

export type DuelDisplayedRound =
  | ({ readonly terminal: false } & DuelActiveRound)
  | ({ readonly terminal: true } & DuelTerminalRound)

export interface DuelPlaySession {
  readonly state: DuelPlayState
  readonly opponentPlacements: DuelOpponentPlacementSet
}

/** UX gate only — server cash-out remains authoritative. */
export function canOfferDuelCashOut(round: DuelDisplayedRound): boolean {
  return (
    !round.terminal &&
    (round.provisionalCoins === 1 || round.provisionalCoins === 2)
  )
}

/** Preserve the just-ended ROUND on reload; NEXT ROUND acknowledgement is a later UI step. */
export function selectDuelDisplayedRound(state: DuelPlayState): DuelDisplayedRound | null {
  if (state.latestTerminalRound) return { ...state.latestTerminalRound, terminal: true }
  if (state.activeRound) return { ...state.activeRound, terminal: false }
  return null
}

/** True when GET /play still has a playable active ROUND (no new ack / DB write). */
export function canAdvanceDuelPlay(state: DuelPlayState): boolean {
  return state.activeRound !== null
}

/**
 * REVEAL plan for one ended ROUND. Skips already-opened bags (SOLO parity).
 * Uses only the reveal payload for that roundNumber — never other rounds.
 */
export function buildDuelRevealPlan(
  reveal: DuelRoundReveal,
  openedBagNumbers: readonly number[],
): RevealPlan {
  const opened = new Set(openedBagNumbers)
  const bagCount = reveal.bagCount as BagCount
  const formation = getFormation(bagCount)
  const sprites: RevealSprite[] = []

  for (const bag of reveal.bags) {
    if (opened.has(bag.bagNumber)) continue
    if (bag.contents.kind === 'empty') continue

    const bagId = bagNumberToBagId(bag.bagNumber)
    const slot = formation.find((entry) => entry.bagId === bagId)
    if (!slot) {
      throw new Error(`buildDuelRevealPlan: missing formation slot for bag ${bag.bagNumber}`)
    }
    const depth = bagDepthZIndex(bagCount, bagId)

    if (bag.contents.kind === 'bomb') {
      sprites.push({
        kind: 'bomb',
        bagId,
        slotX: slot.x,
        slotY: slot.y,
        offsetXBag: 0,
        offsetYBag: 0,
        depthZIndex: depth,
      })
      continue
    }

    const coinCount = bag.contents.coinCount
    const stack = REVEAL_COIN_STACK_OFFSETS[coinCount]
    for (let i = 0; i < stack.length; i += 1) {
      const offset = stack[i]!
      sprites.push({
        kind: 'coin',
        bagId,
        coinIndex: i,
        coinCount,
        slotX: slot.x,
        slotY: slot.y,
        offsetXBag: offset.x,
        offsetYBag: offset.y,
        depthZIndex: depth,
        stackZ: i,
      })
    }
  }

  return { bagCount, sprites }
}

function sameOpen(
  command: DuelOpenCommand,
  input: Pick<DuelOpenCommand, 'matchId' | 'roundNumber' | 'bagNumber' | 'expectedOpenOrder'>,
): boolean {
  return command.matchId === input.matchId &&
    command.roundNumber === input.roundNumber &&
    command.bagNumber === input.bagNumber &&
    command.expectedOpenOrder === input.expectedOpenOrder
}

export function isDuelPlayReady(value: unknown, matchId: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (state.matchId !== matchId) return false
  const self = state.self
  const opponent = state.opponent
  if (
    typeof self !== 'object' || self === null || Array.isArray(self) ||
    typeof opponent !== 'object' || opponent === null || Array.isArray(opponent)
  ) return false
  return (self as Record<string, unknown>).placementLocked === true &&
    (opponent as Record<string, unknown>).placementLocked === true
}

export function createDuelPlayCoordinator(client: DuelPlayClient) {
  let pendingOpen: DuelOpenCommand | null = null
  let pendingCashOut: DuelCashOutCommand | null = null
  let inFlight = false
  let opponentPlacements: DuelOpponentPlacementSet | null = null
  let sessionLoadVersion = 0

  function validateSession(
    state: DuelPlayState,
    placements: DuelOpponentPlacementSet,
  ): void {
    const displayedRound = selectDuelDisplayedRound(state)
    const displayedPlacement = displayedRound
      ? placements.placements[displayedRound.roundNumber - 1]
      : null
    if (
      placements.matchId !== state.matchId ||
      placements.role !== state.role ||
      placements.totalRounds !== state.totalRounds ||
      (displayedRound !== null &&
        (displayedPlacement?.roundNumber !== displayedRound.roundNumber ||
          displayedPlacement.bagCount !== displayedRound.bagCount))
    ) {
      throw new DuelPlayCoordinatorError('session-unavailable')
    }
  }

  return {
    getPendingOpen(): DuelOpenCommand | null {
      return pendingOpen
    },

    async load(matchId: string): Promise<DuelPlayState> {
      const state = await client.getPlayState(matchId)
      if (opponentPlacements?.matchId === matchId) {
        validateSession(state, opponentPlacements)
      }
      return state
    },

    async loadSession(matchId: string): Promise<DuelPlaySession> {
      const loadVersion = ++sessionLoadVersion
      if (opponentPlacements?.matchId !== matchId) opponentPlacements = null
      const state = await client.getPlayState(matchId)
      if (loadVersion !== sessionLoadVersion) {
        throw new DuelPlayCoordinatorError('session-unavailable')
      }
      const placements = opponentPlacements ?? await client.getOpponentPlacements(matchId)
      if (loadVersion !== sessionLoadVersion) {
        throw new DuelPlayCoordinatorError('session-unavailable')
      }
      validateSession(state, placements)
      opponentPlacements = placements
      return { state, opponentPlacements: placements }
    },

    getLocalOpenResult(input: {
      readonly matchId: string
      readonly roundNumber: number
      readonly bagCount: number
      readonly bagNumber: number
    }): DuelLocalOpenResult {
      if (opponentPlacements?.matchId !== input.matchId) {
        throw new DuelPlayCoordinatorError('session-unavailable')
      }
      const placement = opponentPlacements.placements[input.roundNumber - 1]
      if (
        placement?.roundNumber !== input.roundNumber ||
        placement.bagCount !== input.bagCount
      ) {
        throw new DuelPlayCoordinatorError('session-unavailable')
      }
      return judgeDuelOpponentBag(placement, input.bagNumber)
    },

    /** Ended ROUND only — caller must pass that round's number, never a future ROUND. */
    getRoundReveal(matchId: string, roundNumber: number): Promise<DuelRoundReveal> {
      return client.getRoundReveal(matchId, roundNumber)
    },

    getFinalResult(matchId: string): Promise<DuelFinalResult> {
      return client.getFinalResult(matchId)
    },

    getMatchDetail(matchId: string): Promise<DuelMatchDetail> {
      return client.getMatchDetail(matchId)
    },

    async open(input: {
      readonly matchId: string
      readonly roundNumber: number
      readonly bagNumber: number
      readonly expectedOpenOrder: number
    }): Promise<DuelOpenCoordinatorResult> {
      if (inFlight) throw new DuelPlayCoordinatorError('busy')
      if (pendingCashOut) throw new DuelPlayCoordinatorError('retry-required')
      if (pendingOpen && !sameOpen(pendingOpen, input)) {
        throw new DuelPlayCoordinatorError('retry-required')
      }
      pendingOpen ??= client.createOpenCommand(input)
      inFlight = true
      try {
        const result = await client.openBag(pendingOpen)
        pendingOpen = null
        return { kind: 'opened', result }
      } catch (error: unknown) {
        if (error instanceof DuelPlayClientError && error.kind === 'conflict') {
          pendingOpen = null
          return { kind: 'resynced', state: await client.getPlayState(input.matchId) }
        }
        throw error
      } finally {
        inFlight = false
      }
    },

    async cashOut(input: {
      readonly matchId: string
      readonly roundNumber: number
    }): Promise<DuelCashOutCoordinatorResult> {
      if (inFlight) throw new DuelPlayCoordinatorError('busy')
      if (pendingOpen) throw new DuelPlayCoordinatorError('retry-required')
      if (
        pendingCashOut &&
        (pendingCashOut.matchId !== input.matchId ||
          pendingCashOut.roundNumber !== input.roundNumber)
      ) {
        throw new DuelPlayCoordinatorError('retry-required')
      }
      pendingCashOut ??= client.createCashOutCommand(input)
      inFlight = true
      try {
        const result = await client.cashOut(pendingCashOut)
        pendingCashOut = null
        return { kind: 'cashed-out', result }
      } catch (error: unknown) {
        if (error instanceof DuelPlayClientError && error.kind === 'conflict') {
          pendingCashOut = null
          return { kind: 'resynced', state: await client.getPlayState(input.matchId) }
        }
        throw error
      } finally {
        inFlight = false
      }
    },
  }
}
