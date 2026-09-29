import type { BagId } from '../game/assets'
import {
  readParticipant,
  type StorageAdapter,
} from './duelPersistence'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DuelPlayClientErrorKind =
  | 'invalid-request'
  | 'unavailable'
  | 'conflict'
  | 'malformed-response'
  | 'network'
  | 'server'

export class DuelPlayClientError extends Error {
  readonly kind: DuelPlayClientErrorKind

  constructor(kind: DuelPlayClientErrorKind) {
    super('The DUEL play request could not be completed.')
    this.name = 'DuelPlayClientError'
    this.kind = kind
  }
}

export type DuelPlayOutcome = 'empty' | 'coins' | 'bomb'
export type DuelPlayEndReason = 'bombed' | 'cashed_out' | 'cleared'

export interface DuelOpenedBag {
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: DuelPlayOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

export interface DuelActiveRound {
  readonly roundNumber: number
  readonly bagCount: number
  readonly openedBags: readonly DuelOpenedBag[]
  readonly provisionalCoins: 0 | 1 | 2
  readonly nextOpenOrder: number
}

export interface DuelTerminalRound {
  readonly roundNumber: number
  readonly bagCount: number
  readonly openedBags: readonly DuelOpenedBag[]
  readonly endReason: DuelPlayEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
}

export interface DuelPlayState {
  readonly matchId: string
  readonly role: 'A' | 'B'
  readonly totalRounds: number
  readonly participantCompleted: boolean
  readonly nextPlayableRoundNumber: number | null
  readonly activeRound: DuelActiveRound | null
  readonly latestTerminalRound: DuelTerminalRound | null
}

export interface DuelOpenCommand {
  readonly matchId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly expectedOpenOrder: number
  readonly requestId: string
}

export interface DuelOpenResult {
  readonly matchId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: DuelPlayOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: 'bombed' | 'cleared' | null
  readonly capturedCoins: 0 | 3 | null
  readonly participantCompleted: boolean
}

export interface DuelCashOutCommand {
  readonly matchId: string
  readonly roundNumber: number
  readonly requestId: string
}

export interface DuelCashOutResult {
  readonly matchId: string
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly participantCompleted: boolean
}

export type DuelRevealContents =
  | { readonly kind: 'empty' }
  | { readonly kind: 'coins'; readonly coinCount: 1 | 2 | 3 }
  | { readonly kind: 'bomb' }

export interface DuelRoundReveal {
  readonly matchId: string
  readonly roundNumber: number
  readonly bagCount: number
  readonly bags: readonly {
    readonly bagNumber: number
    readonly contents: DuelRevealContents
  }[]
}

export interface DuelPlayClientDependencies {
  readonly storage: StorageAdapter
  readonly fetch: typeof fetch
  readonly crypto: Pick<Crypto, 'randomUUID'>
}

function fail(kind: DuelPlayClientErrorKind): never {
  throw new DuelPlayClientError(kind)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('malformed-response')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    return fail('malformed-response')
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return fail('malformed-response')
  }
  return value as number
}

function requestInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return fail('invalid-request')
  }
  return value as number
}

function matchId(value: unknown, errorKind: DuelPlayClientErrorKind): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return fail(errorKind)
  return value.toLowerCase()
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return fail('invalid-request')
  }
  return value.toLowerCase()
}

function expectedMatch(value: unknown, expected: string): string {
  const parsed = matchId(value, 'malformed-response')
  if (parsed !== expected) return fail('malformed-response')
  return parsed
}

function openedBags(value: unknown, bagCount: number): readonly DuelOpenedBag[] {
  if (!Array.isArray(value) || value.length > bagCount) return fail('malformed-response')
  const seen = new Set<number>()
  return value.map((entry, index) => {
    const item = record(entry)
    exactKeys(item, ['bagNumber', 'openOrder', 'outcome', 'coinsFound'])
    const bagNumber = integer(item.bagNumber, 1, bagCount)
    const openOrder = integer(item.openOrder, 1, bagCount)
    if (openOrder !== index + 1 || seen.has(bagNumber)) return fail('malformed-response')
    seen.add(bagNumber)
    if (!['empty', 'coins', 'bomb'].includes(item.outcome as string)) {
      return fail('malformed-response')
    }
    const outcome = item.outcome as DuelPlayOutcome
    const coinsFound = integer(item.coinsFound, 0, 3) as 0 | 1 | 2 | 3
    if (
      (outcome === 'coins' && coinsFound === 0) ||
      (outcome !== 'coins' && coinsFound !== 0)
    ) {
      return fail('malformed-response')
    }
    return { bagNumber, openOrder, outcome, coinsFound }
  })
}

function activeRound(value: unknown, totalRounds: number): DuelActiveRound | null {
  if (value === null) return null
  const item = record(value)
  exactKeys(item, [
    'roundNumber', 'bagCount', 'openedBags', 'provisionalCoins', 'nextOpenOrder',
  ])
  const bagCount = integer(item.bagCount, 3, 8)
  const bags = openedBags(item.openedBags, bagCount)
  const provisionalCoins = integer(item.provisionalCoins, 0, 2) as 0 | 1 | 2
  const nextOpenOrder = integer(item.nextOpenOrder, 1, bagCount + 1)
  if (nextOpenOrder !== bags.length + 1) return fail('malformed-response')
  return {
    roundNumber: integer(item.roundNumber, 1, totalRounds),
    bagCount,
    openedBags: bags,
    provisionalCoins,
    nextOpenOrder,
  }
}

function terminalRound(value: unknown, totalRounds: number): DuelTerminalRound | null {
  if (value === null) return null
  const item = record(value)
  exactKeys(item, [
    'roundNumber', 'bagCount', 'openedBags', 'endReason', 'capturedCoins',
    'openedBagCount',
  ])
  const bagCount = integer(item.bagCount, 3, 8)
  const bags = openedBags(item.openedBags, bagCount)
  if (!['bombed', 'cashed_out', 'cleared'].includes(item.endReason as string)) {
    return fail('malformed-response')
  }
  const endReason = item.endReason as DuelPlayEndReason
  const capturedCoins = integer(item.capturedCoins, 0, 3) as 0 | 1 | 2 | 3
  const openedBagCount = integer(item.openedBagCount, 1, bagCount)
  if (
    openedBagCount !== bags.length ||
    (endReason === 'bombed' && capturedCoins !== 0) ||
    (endReason === 'cashed_out' && capturedCoins !== 1 && capturedCoins !== 2) ||
    (endReason === 'cleared' && capturedCoins !== 3)
  ) {
    return fail('malformed-response')
  }
  return {
    roundNumber: integer(item.roundNumber, 1, totalRounds),
    bagCount,
    openedBags: bags,
    endReason,
    capturedCoins,
    openedBagCount,
  }
}

function parsePlayState(value: unknown, expected: string): DuelPlayState {
  const item = record(value)
  exactKeys(item, [
    'matchId', 'role', 'totalRounds', 'participantCompleted',
    'nextPlayableRoundNumber', 'activeRound', 'latestTerminalRound',
  ])
  expectedMatch(item.matchId, expected)
  if (item.role !== 'A' && item.role !== 'B') return fail('malformed-response')
  if (typeof item.participantCompleted !== 'boolean') return fail('malformed-response')
  const totalRounds = integer(item.totalRounds, 1, 20)
  const active = activeRound(item.activeRound, totalRounds)
  const terminal = terminalRound(item.latestTerminalRound, totalRounds)
  const next = item.nextPlayableRoundNumber === null
    ? null
    : integer(item.nextPlayableRoundNumber, 1, totalRounds)
  if (
    item.participantCompleted
      ? active !== null || next !== null || terminal?.roundNumber !== totalRounds
      : active === null || next !== active.roundNumber ||
        (active.roundNumber === 1 ? terminal !== null : terminal?.roundNumber !== active.roundNumber - 1)
  ) {
    return fail('malformed-response')
  }
  return {
    matchId: expected,
    role: item.role,
    totalRounds,
    participantCompleted: item.participantCompleted,
    nextPlayableRoundNumber: next,
    activeRound: active,
    latestTerminalRound: terminal,
  }
}

function parseOpenResult(
  value: unknown,
  command: DuelOpenCommand,
): DuelOpenResult {
  const item = record(value)
  exactKeys(item, [
    'matchId', 'roundNumber', 'bagNumber', 'openOrder', 'outcome', 'coinsFound',
    'provisionalCoins', 'openedBagCount', 'roundEnded', 'endReason',
    'capturedCoins', 'participantCompleted',
  ])
  expectedMatch(item.matchId, command.matchId)
  if (
    item.roundNumber !== command.roundNumber ||
    item.bagNumber !== command.bagNumber ||
    item.openOrder !== command.expectedOpenOrder ||
    typeof item.roundEnded !== 'boolean' ||
    typeof item.participantCompleted !== 'boolean' ||
    !['empty', 'coins', 'bomb'].includes(item.outcome as string)
  ) {
    return fail('malformed-response')
  }
  const outcome = item.outcome as DuelPlayOutcome
  const coinsFound = integer(item.coinsFound, 0, 3) as 0 | 1 | 2 | 3
  const provisionalCoins = integer(item.provisionalCoins, 0, 3) as 0 | 1 | 2 | 3
  const openedBagCount = integer(item.openedBagCount, 1, 8)
  if (
    openedBagCount !== command.expectedOpenOrder ||
    (outcome === 'coins' && coinsFound === 0) ||
    (outcome !== 'coins' && coinsFound !== 0)
  ) {
    return fail('malformed-response')
  }
  const endReason = item.endReason
  const capturedCoins = item.capturedCoins
  if (
    item.roundEnded
      ? !(
          (endReason === 'bombed' && capturedCoins === 0 && outcome === 'bomb') ||
          (endReason === 'cleared' && capturedCoins === 3 && provisionalCoins === 3)
        )
      : endReason !== null || capturedCoins !== null || outcome === 'bomb'
  ) {
    return fail('malformed-response')
  }
  return {
    matchId: command.matchId,
    roundNumber: command.roundNumber,
    bagNumber: command.bagNumber,
    openOrder: command.expectedOpenOrder,
    outcome,
    coinsFound,
    provisionalCoins,
    openedBagCount,
    roundEnded: item.roundEnded,
    endReason: endReason as 'bombed' | 'cleared' | null,
    capturedCoins: capturedCoins as 0 | 3 | null,
    participantCompleted: item.participantCompleted,
  }
}

function parseCashOutResult(
  value: unknown,
  command: DuelCashOutCommand,
): DuelCashOutResult {
  const item = record(value)
  exactKeys(item, [
    'matchId', 'roundNumber', 'endReason', 'capturedCoins',
    'openedBagCount', 'participantCompleted',
  ])
  expectedMatch(item.matchId, command.matchId)
  if (
    item.roundNumber !== command.roundNumber ||
    item.endReason !== 'cashed_out' ||
    (item.capturedCoins !== 1 && item.capturedCoins !== 2) ||
    !Number.isInteger(item.openedBagCount) ||
    (item.openedBagCount as number) < 1 ||
    (item.openedBagCount as number) > 8 ||
    typeof item.participantCompleted !== 'boolean'
  ) {
    return fail('malformed-response')
  }
  return {
    matchId: command.matchId,
    roundNumber: command.roundNumber,
    endReason: 'cashed_out',
    capturedCoins: item.capturedCoins,
    openedBagCount: item.openedBagCount as number,
    participantCompleted: item.participantCompleted,
  }
}

function parseReveal(value: unknown, expected: string, roundNumber: number): DuelRoundReveal {
  const item = record(value)
  exactKeys(item, ['matchId', 'roundNumber', 'bagCount', 'bags'])
  expectedMatch(item.matchId, expected)
  if (item.roundNumber !== roundNumber) return fail('malformed-response')
  const bagCount = integer(item.bagCount, 3, 8)
  if (!Array.isArray(item.bags) || item.bags.length !== bagCount) {
    return fail('malformed-response')
  }
  let bombCount = 0
  let coinTotal = 0
  const bags = item.bags.map((entry, index) => {
    const bag = record(entry)
    exactKeys(bag, ['bagNumber', 'contents'])
    const bagNumber = integer(bag.bagNumber, 1, bagCount)
    if (bagNumber !== index + 1) return fail('malformed-response')
    const contents = record(bag.contents)
    if (contents.kind === 'empty' || contents.kind === 'bomb') {
      exactKeys(contents, ['kind'])
      if (contents.kind === 'bomb') bombCount += 1
      return { bagNumber, contents: { kind: contents.kind } } as const
    }
    if (contents.kind !== 'coins') return fail('malformed-response')
    exactKeys(contents, ['kind', 'coinCount'])
    const coinCount = integer(contents.coinCount, 1, 3) as 1 | 2 | 3
    coinTotal += coinCount
    return { bagNumber, contents: { kind: 'coins' as const, coinCount } }
  })
  if (bombCount !== 1 || coinTotal !== 3) return fail('malformed-response')
  return { matchId: expected, roundNumber, bagCount, bags }
}

function participantToken(storage: StorageAdapter, id: string): string {
  try {
    const participant = readParticipant(storage, id)
    if (!participant || participant.matchId !== id) return fail('unavailable')
    return participant.token
  } catch {
    return fail('unavailable')
  }
}

async function fetchJson(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(input, init)
  } catch {
    return fail('network')
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      return fail('unavailable')
    }
    if (response.status === 409) return fail('conflict')
    return fail('server')
  }
  try {
    return await response.json()
  } catch {
    return fail('malformed-response')
  }
}

function headers(token: string, requestIdValue?: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(requestIdValue === undefined ? {} : { 'Idempotency-Key': requestIdValue }),
  }
}

export function bagNumberToBagId(bagNumber: number): BagId {
  const value = requestInteger(bagNumber, 1, 8)
  return `bag-${value}` as BagId
}

export function bagIdToBagNumber(bagId: BagId): number {
  const matched = /^bag-([1-8])$/.exec(bagId)
  if (!matched) return fail('invalid-request')
  return Number(matched[1])
}

export function createDuelPlayClient(dependencies: DuelPlayClientDependencies) {
  const normalizedMatchId = (value: unknown) => matchId(value, 'invalid-request')
  const createRequestId = () => requestId(dependencies.crypto.randomUUID())

  return {
    createOpenCommand(input: {
      matchId: string
      roundNumber: number
      bagNumber: number
      expectedOpenOrder: number
    }): DuelOpenCommand {
      return Object.freeze({
        matchId: normalizedMatchId(input.matchId),
        roundNumber: requestInteger(input.roundNumber, 1, 20),
        bagNumber: requestInteger(input.bagNumber, 1, 8),
        expectedOpenOrder: requestInteger(input.expectedOpenOrder, 1, 8),
        requestId: createRequestId(),
      })
    },

    createCashOutCommand(input: {
      matchId: string
      roundNumber: number
    }): DuelCashOutCommand {
      return Object.freeze({
        matchId: normalizedMatchId(input.matchId),
        roundNumber: requestInteger(input.roundNumber, 1, 20),
        requestId: createRequestId(),
      })
    },

    async getPlayState(matchIdValue: string): Promise<DuelPlayState> {
      const id = normalizedMatchId(matchIdValue)
      const token = participantToken(dependencies.storage, id)
      const json = await fetchJson(
        dependencies.fetch,
        `/api/duel/matches/${encodeURIComponent(id)}/play`,
        { method: 'GET', headers: headers(token) },
      )
      return parsePlayState(json, id)
    },

    async openBag(commandValue: DuelOpenCommand): Promise<DuelOpenResult> {
      const command: DuelOpenCommand = {
        matchId: normalizedMatchId(commandValue.matchId),
        roundNumber: requestInteger(commandValue.roundNumber, 1, 20),
        bagNumber: requestInteger(commandValue.bagNumber, 1, 8),
        expectedOpenOrder: requestInteger(commandValue.expectedOpenOrder, 1, 8),
        requestId: requestId(commandValue.requestId),
      }
      const token = participantToken(dependencies.storage, command.matchId)
      const json = await fetchJson(
        dependencies.fetch,
        `/api/duel/matches/${encodeURIComponent(command.matchId)}/rounds/${command.roundNumber}/open`,
        {
          method: 'POST',
          headers: {
            ...headers(token, command.requestId),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bagNumber: command.bagNumber,
            expectedOpenOrder: command.expectedOpenOrder,
          }),
        },
      )
      return parseOpenResult(json, command)
    },

    async cashOut(commandValue: DuelCashOutCommand): Promise<DuelCashOutResult> {
      const command: DuelCashOutCommand = {
        matchId: normalizedMatchId(commandValue.matchId),
        roundNumber: requestInteger(commandValue.roundNumber, 1, 20),
        requestId: requestId(commandValue.requestId),
      }
      const token = participantToken(dependencies.storage, command.matchId)
      const json = await fetchJson(
        dependencies.fetch,
        `/api/duel/matches/${encodeURIComponent(command.matchId)}/rounds/${command.roundNumber}/cash-out`,
        { method: 'POST', headers: headers(token, command.requestId) },
      )
      return parseCashOutResult(json, command)
    },

    async getRoundReveal(
      matchIdValue: string,
      roundNumberValue: number,
    ): Promise<DuelRoundReveal> {
      const id = normalizedMatchId(matchIdValue)
      const roundNumber = requestInteger(roundNumberValue, 1, 20)
      const token = participantToken(dependencies.storage, id)
      const json = await fetchJson(
        dependencies.fetch,
        `/api/duel/matches/${encodeURIComponent(id)}/rounds/${roundNumber}/reveal`,
        { method: 'GET', headers: headers(token) },
      )
      return parseReveal(json, id, roundNumber)
    },
  }
}
