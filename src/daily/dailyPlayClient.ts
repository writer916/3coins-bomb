import { randomUuid, type RandomUuidCrypto } from '../browser/randomUuid'
import type { BagId } from '../game/assets'
import { DAILY_CHALLENGE_ROUNDS } from './dailyQuestionSet'
import type { DailyChallengeDate } from './dailyChallengeDate'
import {
  judgeDailyBag,
  validateDailyPlayPlacement,
  type DailyLocalOpenResult,
  type DailyPlayPlacement,
} from './dailyLocalOpen'
import {
  readDailyParticipant,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
} from './dailyParticipantStorage'

export type { DailyLocalOpenResult, DailyPlayPlacement }
export {
  judgeDailyBag,
  sameDailyLocalAndServerOpen,
  validateDailyPlayPlacement,
} from './dailyLocalOpen'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DailyPlayClientErrorCode =
  | 'NETWORK_FAILURE'
  | 'TEMPORARY_FAILURE'
  | 'AUTHENTICATION_FAILED'
  | 'UNAVAILABLE'
  | 'CONFLICT'
  | 'INVALID_RESPONSE'

export class DailyPlayClientError extends Error {
  readonly code: DailyPlayClientErrorCode

  constructor(code: DailyPlayClientErrorCode) {
    super('The DAILY play request could not be completed.')
    this.name = 'DailyPlayClientError'
    this.code = code
  }
}

export type DailyOpenOutcome = 'empty' | 'coins' | 'bomb'
export type DailyOpenEndReason = 'bombed' | 'cleared' | null
export type DailyRoundEndReason =
  | 'bombed'
  | 'cleared'
  | 'cashed_out'
  | 'timed_out'

export interface DailyPlayOpenView {
  readonly openOrder: number
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
  readonly openedAt: string
  readonly outcome: DailyOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
}

export interface DailyPlayActiveAttempt {
  readonly roundNumber: number
  readonly bagCount: number
  readonly startedAt: string
  readonly deadlineAt: string
  readonly openedBagCount: number
  readonly opens: readonly DailyPlayOpenView[]
}

export interface DailyPlayState {
  readonly challengeDate: DailyChallengeDate
  readonly serverNow: string
  readonly challengeEndsAt: string
  readonly completedRounds: number
  readonly nextRoundNumber: number | null
  readonly activeAttempt: DailyPlayActiveAttempt | null
  readonly completedAt: string | null
  readonly expiredAt: string | null
}

export interface DailyOpenCommand {
  readonly challengeDate: DailyChallengeDate
  readonly bagNumber: number
  readonly remainingSecondsAtTap: number
  readonly requestId: string
}

export interface DailyOpenResult {
  readonly challengeDate: DailyChallengeDate
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly remainingSecondsAtTap: number
  readonly outcome: DailyOpenOutcome
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: DailyOpenEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly elapsedSeconds: number | null
  readonly coinBagHits: number | null
  readonly participantCompleted: boolean
}

export interface DailyCashOutCommand {
  readonly challengeDate: DailyChallengeDate
  readonly remainingSecondsAtTap: number
  readonly requestId: string
}

export interface DailyCashOutResult {
  readonly challengeDate: DailyChallengeDate
  readonly roundNumber: number
  readonly endReason: 'cashed_out'
  readonly capturedCoins: 1 | 2
  readonly openedBagCount: number
  readonly elapsedSeconds: number
  readonly coinBagHits: number
  readonly remainingSecondsAtTap: number
  readonly participantCompleted: boolean
}

export interface DailyPlacementsSet {
  readonly challengeDate: DailyChallengeDate
  readonly formationVersion: 1
  readonly ruleVersion: 1
  readonly placements: readonly DailyPlayPlacement[]
}

function fail(code: DailyPlayClientErrorCode = 'INVALID_RESPONSE'): never {
  throw new DailyPlayClientError(code)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail()
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...keys].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    return fail()
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return fail()
  }
  return value
}

function iso(value: unknown): string {
  if (typeof value !== 'string') return fail()
  try {
    if (new Date(value).toISOString() !== value) return fail()
  } catch {
    return fail()
  }
  return value
}

function optionalIso(value: unknown): string | null {
  return value === null ? null : iso(value)
}

function dateString(value: unknown): DailyChallengeDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail()
  }
  return value
}

export function bagNumberToBagId(bagNumber: number): BagId {
  return `bag-${integer(bagNumber, 1, 8)}` as BagId
}

export function bagIdToBagNumber(bagId: BagId): number {
  const matched = /^bag-([1-8])$/.exec(bagId)
  if (!matched) return fail()
  return Number(matched[1])
}

export function parseDailyPlayState(
  value: unknown,
  expectedDate: string,
): DailyPlayState {
  const state = record(value)
  exact(state, [
    'challengeDate',
    'serverNow',
    'challengeEndsAt',
    'completedRounds',
    'nextRoundNumber',
    'activeAttempt',
    'completedAt',
    'expiredAt',
  ])
  const challengeDate = dateString(state.challengeDate)
  if (challengeDate !== expectedDate) return fail()
  const completedRounds = integer(
    state.completedRounds,
    0,
    DAILY_CHALLENGE_ROUNDS,
  )
  const nextRoundNumber =
    state.nextRoundNumber === null
      ? null
      : integer(state.nextRoundNumber, 1, DAILY_CHALLENGE_ROUNDS)
  const active =
    state.activeAttempt === null ? null : record(state.activeAttempt)
  let activeAttempt: DailyPlayActiveAttempt | null = null
  if (active) {
    exact(active, [
      'roundNumber',
      'bagCount',
      'startedAt',
      'deadlineAt',
      'openedBagCount',
      'opens',
    ])
    if (!Array.isArray(active.opens)) return fail()
    const opens = active.opens.map((entry) => {
      const open = record(entry)
      exact(open, [
        'openOrder',
        'bagNumber',
        'remainingSecondsAtTap',
        'openedAt',
        'outcome',
        'coinsFound',
      ])
      const outcomeRaw = open.outcome
      if (
        outcomeRaw !== 'empty' &&
        outcomeRaw !== 'coins' &&
        outcomeRaw !== 'bomb'
      ) {
        return fail()
      }
      const outcome: DailyOpenOutcome = outcomeRaw
      const coinsFound = integer(open.coinsFound, 0, 3) as 0 | 1 | 2 | 3
      return {
        openOrder: integer(open.openOrder, 1, 8),
        bagNumber: integer(open.bagNumber, 1, 8),
        remainingSecondsAtTap: integer(open.remainingSecondsAtTap, 1, 60),
        openedAt: iso(open.openedAt),
        outcome,
        coinsFound,
      }
    })
    const parsedActive: DailyPlayActiveAttempt = {
      roundNumber: integer(active.roundNumber, 1, DAILY_CHALLENGE_ROUNDS),
      bagCount: integer(active.bagCount, 3, 8),
      startedAt: iso(active.startedAt),
      deadlineAt: iso(active.deadlineAt),
      openedBagCount: integer(active.openedBagCount, 0, 8),
      opens,
    }
    if (parsedActive.openedBagCount !== opens.length) return fail()
    activeAttempt = parsedActive
  }
  return {
    challengeDate,
    serverNow: iso(state.serverNow),
    challengeEndsAt: iso(state.challengeEndsAt),
    completedRounds,
    nextRoundNumber,
    activeAttempt,
    completedAt: optionalIso(state.completedAt),
    expiredAt: optionalIso(state.expiredAt),
  }
}

export function parseDailyOpenResult(
  value: unknown,
  command: DailyOpenCommand,
): DailyOpenResult {
  const result = record(value)
  exact(result, [
    'challengeDate',
    'roundNumber',
    'bagNumber',
    'openOrder',
    'remainingSecondsAtTap',
    'outcome',
    'coinsFound',
    'provisionalCoins',
    'openedBagCount',
    'roundEnded',
    'endReason',
    'capturedCoins',
    'elapsedSeconds',
    'coinBagHits',
    'participantCompleted',
  ])
  if (
    dateString(result.challengeDate) !== command.challengeDate ||
    result.bagNumber !== command.bagNumber
  ) {
    return fail()
  }
  const outcome = result.outcome
  if (outcome !== 'empty' && outcome !== 'coins' && outcome !== 'bomb') {
    return fail()
  }
  const coinsFound = integer(result.coinsFound, 0, 3) as 0 | 1 | 2 | 3
  const provisionalCoins = integer(
    result.provisionalCoins,
    0,
    3,
  ) as 0 | 1 | 2 | 3
  const capturedCoins = integer(result.capturedCoins, 0, 3) as 0 | 1 | 2 | 3
  if (
    typeof result.roundEnded !== 'boolean' ||
    typeof result.participantCompleted !== 'boolean' ||
    (result.endReason !== null &&
      result.endReason !== 'bombed' &&
      result.endReason !== 'cleared')
  ) {
    return fail()
  }
  if (
    outcome === 'bomb' &&
    (coinsFound !== 0 ||
      !result.roundEnded ||
      result.endReason !== 'bombed' ||
      capturedCoins !== 0)
  ) {
    return fail()
  }
  if (
    result.endReason === 'cleared' &&
    (capturedCoins !== 3 || provisionalCoins !== 3 || !result.roundEnded)
  ) {
    return fail()
  }
  return {
    challengeDate: command.challengeDate,
    roundNumber: integer(result.roundNumber, 1, DAILY_CHALLENGE_ROUNDS),
    bagNumber: command.bagNumber,
    openOrder: integer(result.openOrder, 1, 8),
    remainingSecondsAtTap: integer(result.remainingSecondsAtTap, 1, 60),
    outcome,
    coinsFound,
    provisionalCoins,
    openedBagCount: integer(result.openedBagCount, 1, 8),
    roundEnded: result.roundEnded,
    endReason: result.endReason,
    capturedCoins,
    elapsedSeconds:
      result.elapsedSeconds === null
        ? null
        : integer(result.elapsedSeconds, 0, 60),
    coinBagHits:
      result.coinBagHits === null
        ? null
        : integer(result.coinBagHits, 0, 8),
    participantCompleted: result.participantCompleted,
  }
}

export function parseDailyCashOutResult(
  value: unknown,
  command: DailyCashOutCommand,
): DailyCashOutResult {
  const result = record(value)
  exact(result, [
    'challengeDate',
    'roundNumber',
    'endReason',
    'capturedCoins',
    'openedBagCount',
    'elapsedSeconds',
    'coinBagHits',
    'remainingSecondsAtTap',
    'participantCompleted',
  ])
  if (
    dateString(result.challengeDate) !== command.challengeDate ||
    result.endReason !== 'cashed_out' ||
    typeof result.participantCompleted !== 'boolean'
  ) {
    return fail()
  }
  const capturedCoins = integer(result.capturedCoins, 1, 2) as 1 | 2
  return {
    challengeDate: command.challengeDate,
    roundNumber: integer(result.roundNumber, 1, DAILY_CHALLENGE_ROUNDS),
    endReason: 'cashed_out',
    capturedCoins,
    openedBagCount: integer(result.openedBagCount, 1, 8),
    elapsedSeconds: integer(result.elapsedSeconds, 0, 59),
    coinBagHits: integer(result.coinBagHits, 0, 8),
    remainingSecondsAtTap: integer(result.remainingSecondsAtTap, 1, 60),
    participantCompleted: result.participantCompleted,
  }
}

function classifyHttp(status: number): DailyPlayClientErrorCode {
  if (status === 401) return 'AUTHENTICATION_FAILED'
  if (status === 404) return 'UNAVAILABLE'
  if (status === 409) return 'CONFLICT'
  if (status === 503 || status >= 500) return 'TEMPORARY_FAILURE'
  return 'NETWORK_FAILURE'
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return fail()
  }
}

export function provisionalCoinsFromOpens(
  opens: readonly Pick<DailyPlayOpenView, 'coinsFound' | 'outcome'>[],
): 0 | 1 | 2 | 3 {
  let total = 0
  for (const open of opens) {
    if (open.outcome === 'bomb') return 0
    total += open.coinsFound
  }
  if (total > 3) return fail()
  return total as 0 | 1 | 2 | 3
}

/** Strict parse of GET /placements — rejects malformed DTOs. */
export function parseDailyPlacements(
  value: unknown,
  expectedDate: string,
): DailyPlacementsSet {
  const body = record(value)
  exact(body, [
    'challengeDate',
    'formationVersion',
    'ruleVersion',
    'placements',
  ])
  const challengeDate = dateString(body.challengeDate)
  if (challengeDate !== expectedDate) return fail()
  if (body.formationVersion !== 1 || body.ruleVersion !== 1) return fail()
  if (
    !Array.isArray(body.placements) ||
    body.placements.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    return fail()
  }
  try {
    const placements = body.placements.map((entry, index) =>
      validateDailyPlayPlacement(entry, index + 1),
    )
    return {
      challengeDate,
      formationVersion: 1,
      ruleVersion: 1,
      placements,
    }
  } catch {
    return fail()
  }
}

export function createDailyPlayClient(dependencies: {
  readonly storage: DailyStorageAdapter
  readonly fetch: typeof fetch
  readonly crypto: RandomUuidCrypto
}) {
  function participant(challengeDate: string): JoinedDailyParticipantRecord {
    const record = readDailyParticipant(dependencies.storage, challengeDate)
    if (!record || record.phase !== 'joined') return fail('UNAVAILABLE')
    return record
  }

  function auth(challengeDate: string) {
    return {
      Authorization: `Bearer ${participant(challengeDate).token}`,
      'Cache-Control': 'no-store',
    }
  }

  return {
    createRequestId() {
      const id = randomUuid(dependencies.crypto)
      if (!UUID_V4.test(id)) return fail()
      return id.toLowerCase()
    },

    async getPlay(challengeDate: string): Promise<DailyPlayState> {
      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/daily/challenges/${encodeURIComponent(challengeDate)}/play`,
          { method: 'GET', headers: auth(challengeDate) },
        )
      } catch {
        return fail('NETWORK_FAILURE')
      }
      if (!response.ok) return fail(classifyHttp(response.status))
      return parseDailyPlayState(await readJson(response), challengeDate)
    },

    async startRound(
      challengeDate: string,
      requestId: string = randomUuid(dependencies.crypto),
    ): Promise<DailyPlayState> {
      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/daily/challenges/${encodeURIComponent(challengeDate)}/rounds/start`,
          {
            method: 'POST',
            headers: {
              ...auth(challengeDate),
              'Idempotency-Key': requestId,
            },
          },
        )
      } catch {
        return fail('NETWORK_FAILURE')
      }
      if (!response.ok) return fail(classifyHttp(response.status))
      return parseDailyPlayState(await readJson(response), challengeDate)
    },

    createOpenCommand(
      challengeDate: string,
      bagNumber: number,
      remainingSecondsAtTap: number,
    ): DailyOpenCommand {
      return {
        challengeDate: dateString(challengeDate),
        bagNumber: integer(bagNumber, 1, 8),
        remainingSecondsAtTap: integer(remainingSecondsAtTap, 1, 60),
        requestId: randomUuid(dependencies.crypto).toLowerCase(),
      }
    },

    async openBag(command: DailyOpenCommand): Promise<DailyOpenResult> {
      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/daily/challenges/${encodeURIComponent(command.challengeDate)}/rounds/open`,
          {
            method: 'POST',
            headers: {
              ...auth(command.challengeDate),
              'Idempotency-Key': command.requestId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              bagNumber: command.bagNumber,
              remainingSecondsAtTap: command.remainingSecondsAtTap,
            }),
          },
        )
      } catch {
        return fail('NETWORK_FAILURE')
      }
      if (!response.ok) return fail(classifyHttp(response.status))
      return parseDailyOpenResult(await readJson(response), command)
    },

    createCashOutCommand(
      challengeDate: string,
      remainingSecondsAtTap: number,
    ): DailyCashOutCommand {
      return {
        challengeDate: dateString(challengeDate),
        remainingSecondsAtTap: integer(remainingSecondsAtTap, 1, 60),
        requestId: randomUuid(dependencies.crypto).toLowerCase(),
      }
    },

    async cashOut(command: DailyCashOutCommand): Promise<DailyCashOutResult> {
      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/daily/challenges/${encodeURIComponent(command.challengeDate)}/rounds/cash-out`,
          {
            method: 'POST',
            headers: {
              ...auth(command.challengeDate),
              'Idempotency-Key': command.requestId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              remainingSecondsAtTap: command.remainingSecondsAtTap,
            }),
          },
        )
      } catch {
        return fail('NETWORK_FAILURE')
      }
      if (!response.ok) return fail(classifyHttp(response.status))
      return parseDailyCashOutResult(await readJson(response), command)
    },

    async getPlacements(challengeDate: string): Promise<DailyPlacementsSet> {
      let response: Response
      try {
        response = await dependencies.fetch(
          `/api/daily/challenges/${encodeURIComponent(challengeDate)}/placements`,
          { method: 'GET', headers: auth(challengeDate) },
        )
      } catch {
        return fail('NETWORK_FAILURE')
      }
      if (!response.ok) return fail(classifyHttp(response.status))
      return parseDailyPlacements(await readJson(response), challengeDate)
    },
  }
}

export function createDailyPlayCoordinator(
  client: ReturnType<typeof createDailyPlayClient>,
) {
  let startRequestId: string | null = null
  let pendingOpen: DailyOpenCommand | null = null
  let pendingCashOut: DailyCashOutCommand | null = null
  let openInFlight = false
  /** In-memory only — never reuse across challenge dates or page reloads. */
  let cachedPlacements: DailyPlacementsSet | null = null

  async function ensurePlacements(
    challengeDate: string,
  ): Promise<DailyPlacementsSet> {
    const date = dateString(challengeDate)
    if (cachedPlacements?.challengeDate === date) return cachedPlacements
    cachedPlacements = await client.getPlacements(date)
    return cachedPlacements
  }

  function getPlacementForRound(
    challengeDate: string,
    roundNumber: number,
    bagCount: number,
  ): DailyPlayPlacement {
    const date = dateString(challengeDate)
    if (cachedPlacements?.challengeDate !== date) return fail('UNAVAILABLE')
    const placement = cachedPlacements.placements[roundNumber - 1]
    if (
      !placement ||
      placement.roundNumber !== roundNumber ||
      placement.bagCount !== bagCount
    ) {
      return fail('UNAVAILABLE')
    }
    return placement
  }

  function getLocalOpenResult(
    challengeDate: string,
    roundNumber: number,
    bagCount: number,
    bagNumber: number,
  ): DailyLocalOpenResult {
    return judgeDailyBag(
      getPlacementForRound(challengeDate, roundNumber, bagCount),
      bagNumber,
    )
  }

  return {
    getPendingOpen() {
      return pendingOpen
    },
    getPendingCashOut() {
      return pendingCashOut
    },

    /** Clears pending OPEN after GET play proves the bag was already recorded. */
    clearPendingOpen() {
      pendingOpen = null
    },

    /** Clears pending CASH OUT after GET play / idempotent retry proves success. */
    clearPendingCashOut() {
      pendingCashOut = null
    },

    getCachedPlacements() {
      return cachedPlacements
    },

    getPlacementForRound,
    getLocalOpenResult,

    async loadOrStart(challengeDate: string): Promise<DailyPlayState> {
      const date = dateString(challengeDate)
      // Always (re)load placements on bootstrap / resume so reloads stay fresh.
      cachedPlacements = null
      await ensurePlacements(date)

      let state = await client.getPlay(date)
      if (state.activeAttempt) return state
      if (state.completedAt || state.expiredAt || state.nextRoundNumber === null) {
        return state
      }
      startRequestId ??= client.createRequestId()
      state = await client.startRound(date, startRequestId)
      startRequestId = null
      return state
    },

    async refresh(challengeDate: string): Promise<DailyPlayState> {
      return client.getPlay(challengeDate)
    },

    async startNext(challengeDate: string): Promise<DailyPlayState> {
      const date = dateString(challengeDate)
      // Keep cached placements for the same day; require them before advancing.
      await ensurePlacements(date)
      startRequestId ??= client.createRequestId()
      const state = await client.startRound(date, startRequestId)
      startRequestId = null
      if (!state.activeAttempt) return fail('UNAVAILABLE')
      // Prove the next play-round slot exists before returning.
      getPlacementForRound(
        date,
        state.activeAttempt.roundNumber,
        state.activeAttempt.bagCount,
      )
      return state
    },

    async open(
      challengeDate: string,
      bagNumber: number,
      remainingSecondsAtTap: number,
    ): Promise<DailyOpenResult> {
      if (openInFlight || pendingCashOut) return fail('CONFLICT')
      if (
        pendingOpen &&
        (pendingOpen.challengeDate !== challengeDate ||
          pendingOpen.bagNumber !== bagNumber)
      ) {
        return fail('CONFLICT')
      }
      pendingOpen ??= client.createOpenCommand(
        challengeDate,
        bagNumber,
        remainingSecondsAtTap,
      )
      // Keep the remaining seconds from the first attempt of this request id.
      openInFlight = true
      try {
        const result = await client.openBag(pendingOpen)
        pendingOpen = null
        return result
      } finally {
        openInFlight = false
      }
    },

    async cashOut(
      challengeDate: string,
      remainingSecondsAtTap: number,
    ): Promise<DailyCashOutResult> {
      if (openInFlight || pendingOpen) return fail('CONFLICT')
      pendingCashOut ??= client.createCashOutCommand(
        challengeDate,
        remainingSecondsAtTap,
      )
      openInFlight = true
      try {
        const result = await client.cashOut(pendingCashOut)
        pendingCashOut = null
        return result
      } finally {
        openInFlight = false
      }
    },
  }
}

export type DailyPlayCoordinator = ReturnType<typeof createDailyPlayCoordinator>
