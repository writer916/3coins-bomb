import {
  hashDuelToken,
  parseBearerToken,
  validateDuelParticipantToken,
  validateMatchId,
} from '../auth/duelTokens.js'
import {
  persistLockedDuelPlacements,
  type CanonicalDuelRoundPlacement,
  type LockDuelPlacementsInput,
  type LockDuelPlacementsResult,
} from '../db/lockDuelPlacements.js'

export const DUEL_LOCK_BODY_MAX_BYTES = 16_384

export type LockPlacementsErrorCode =
  | 'INVALID_REQUEST'
  | 'MATCH_UNAVAILABLE'
  | 'PLACEMENT_CONFLICT'

export class LockPlacementsError extends Error {
  readonly code: LockPlacementsErrorCode

  constructor(code: LockPlacementsErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'The DUEL placement LOCK request is invalid.'
        : code === 'MATCH_UNAVAILABLE'
          ? 'The DUEL match is unavailable.'
          : 'The DUEL placements conflict with the locked placements.',
    )
    this.name = 'LockPlacementsError'
    this.code = code
  }
}

export interface LockPlacementsRequest {
  readonly matchId: string
  readonly participantToken: string
  readonly placements: readonly CanonicalDuelRoundPlacement[]
}

export interface LockPlacementsResponse {
  readonly matchId: string
  readonly role: 'A' | 'B'
  readonly placementLocked: true
}

export interface LockPlacementsDependencies {
  readonly persist?: (
    input: LockDuelPlacementsInput,
  ) => Promise<LockDuelPlacementsResult>
}

function invalidRequest(): never {
  throw new LockPlacementsError('INVALID_REQUEST')
}

function canonicalPlacement(value: unknown): CanonicalDuelRoundPlacement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest()
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join(',') !==
    'bagCount,bombBagNumber,coinBagNumbers,roundNumber'
  ) {
    return invalidRequest()
  }
  const { roundNumber, bagCount, bombBagNumber, coinBagNumbers } = record
  if (
    !Number.isInteger(roundNumber) ||
    !Number.isInteger(bagCount) ||
    !Number.isInteger(bombBagNumber) ||
    (bagCount as number) < 3 ||
    (bagCount as number) > 8 ||
    (bombBagNumber as number) < 1 ||
    (bombBagNumber as number) > (bagCount as number) ||
    !Array.isArray(coinBagNumbers) ||
    coinBagNumbers.length !== 3 ||
    !coinBagNumbers.every(
      (bag) =>
        Number.isInteger(bag) &&
        (bag as number) >= 1 &&
        (bag as number) <= (bagCount as number) &&
        bag !== bombBagNumber,
    )
  ) {
    return invalidRequest()
  }
  const coins = [...coinBagNumbers].sort((a, b) => (a as number) - (b as number))
  return {
    roundNumber: roundNumber as number,
    bagCount: bagCount as number,
    bombBagNumber: bombBagNumber as number,
    coinBagNumbers: coins as [number, number, number],
  }
}

export function validateLockPlacementsRequest(
  matchId: unknown,
  authorization: unknown,
  body: unknown,
): LockPlacementsRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest()
  }
  const record = body as Record<string, unknown>
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, 'placements') ||
    !Array.isArray(record.placements) ||
    record.placements.length < 1 ||
    record.placements.length > 20
  ) {
    return invalidRequest()
  }
  const placements = record.placements
    .map(canonicalPlacement)
    .sort((a, b) => a.roundNumber - b.roundNumber)
  if (
    placements.some(
      (placement, index) => placement.roundNumber !== index + 1,
    )
  ) {
    return invalidRequest()
  }
  try {
    return {
      matchId: validateMatchId(matchId),
      participantToken: validateDuelParticipantToken(
        parseBearerToken(authorization),
      ),
      placements,
    }
  } catch {
    throw new LockPlacementsError('MATCH_UNAVAILABLE')
  }
}

export async function lockPlacements(
  request: LockPlacementsRequest,
  dependencies: LockPlacementsDependencies = {},
): Promise<LockPlacementsResponse> {
  const persist = dependencies.persist ?? persistLockedDuelPlacements
  const result = await persist({
    matchId: request.matchId,
    participantTokenHash: hashDuelToken(request.participantToken),
    placements: request.placements,
  })
  if (result.status === 'unavailable') {
    throw new LockPlacementsError('MATCH_UNAVAILABLE')
  }
  if (result.status === 'invalid') {
    throw new LockPlacementsError('INVALID_REQUEST')
  }
  if (result.status === 'conflict' || result.role === undefined) {
    throw new LockPlacementsError('PLACEMENT_CONFLICT')
  }
  return {
    matchId: request.matchId,
    role: result.role,
    placementLocked: true,
  }
}
