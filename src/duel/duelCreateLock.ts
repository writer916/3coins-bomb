import type { RandomUuidCrypto } from '../browser/randomUuid'
import type { DuelRoundPlacement } from '../game/duelPlacement'
import {
  completePendingLock,
  createPendingCreateRecord,
  persistCreatedMatchHandoff,
  readARecoveryState,
  savePendingCreate,
  toCanonicalDuelPlacements,
  type CanonicalDuelPlacement,
  type StorageAdapter,
} from './duelPersistence'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PARTICIPANT_TOKEN_PATTERN = /^3cb_pa1_[A-Za-z0-9_-]{43}$/
const INVITATION_TOKEN_PATTERN = /^3cb_pi1_[A-Za-z0-9_-]{43}$/

export type DuelCreateLockErrorCode = 'RECOVERY_MISMATCH' | 'REQUEST_FAILED'

export class DuelCreateLockError extends Error {
  readonly code: DuelCreateLockErrorCode

  constructor(code: DuelCreateLockErrorCode) {
    super('The DUEL match could not be locked.')
    this.name = 'DuelCreateLockError'
    this.code = code
  }
}

export interface DuelCreateLockInput {
  readonly totalRounds: number
  readonly placements: readonly DuelRoundPlacement[]
}

export interface DuelCreateLockResult {
  readonly matchId: string
}

export interface DuelCreateLockDependencies {
  readonly storage: StorageAdapter
  readonly fetch: typeof fetch
  readonly crypto: RandomUuidCrypto
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function samePlacements(
  left: readonly CanonicalDuelPlacement[],
  right: readonly CanonicalDuelPlacement[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseCreateResponse(value: unknown): {
  matchId: string
  totalRounds: number
  participantToken: string
  invitationToken: string
} {
  if (!isRecord(value) || !isRecord(value.participant) || !isRecord(value.invitation)) {
    throw new DuelCreateLockError('REQUEST_FAILED')
  }
  if (
    typeof value.matchId !== 'string' ||
    !UUID_PATTERN.test(value.matchId) ||
    !Number.isInteger(value.totalRounds) ||
    value.participant.role !== 'A' ||
    typeof value.participant.token !== 'string' ||
    !PARTICIPANT_TOKEN_PATTERN.test(value.participant.token) ||
    typeof value.invitation.token !== 'string' ||
    !INVITATION_TOKEN_PATTERN.test(value.invitation.token)
  ) {
    throw new DuelCreateLockError('REQUEST_FAILED')
  }
  return {
    matchId: value.matchId.toLowerCase(),
    totalRounds: value.totalRounds as number,
    participantToken: value.participant.token,
    invitationToken: value.invitation.token,
  }
}

function confirmsLock(value: unknown, matchId: string, totalRounds: number): boolean {
  return (
    isRecord(value) &&
    value.matchId === matchId &&
    value.totalRounds === totalRounds &&
    value.role === 'A' &&
    isRecord(value.self) &&
    value.self.placementLocked === true
  )
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new DuelCreateLockError('REQUEST_FAILED')
  try {
    return await response.json()
  } catch {
    throw new DuelCreateLockError('REQUEST_FAILED')
  }
}

async function executeCreateLock(
  input: DuelCreateLockInput,
  dependencies: DuelCreateLockDependencies,
): Promise<DuelCreateLockResult> {
  try {
    const canonical = toCanonicalDuelPlacements(input.placements, input.totalRounds)
    const recovery = readARecoveryState(dependencies.storage)
    let matchId: string
    let participantToken: string
    let lockPlacements: readonly CanonicalDuelPlacement[]

    if (recovery.phase === 'lock-retry') {
      if (!samePlacements(recovery.pending.placements, canonical)) {
        throw new DuelCreateLockError('RECOVERY_MISMATCH')
      }
      matchId = recovery.pending.matchId
      participantToken = recovery.participant.token
      lockPlacements = recovery.pending.placements
    } else {
      const pending =
        recovery.phase === 'create-retry'
          ? recovery.pending
          : createPendingCreateRecord(
              input.placements,
              input.totalRounds,
              dependencies.crypto,
            )
      if (
        pending.totalRounds !== input.totalRounds ||
        !samePlacements(pending.placements, canonical)
      ) {
        throw new DuelCreateLockError('RECOVERY_MISMATCH')
      }
      if (recovery.phase === 'idle') savePendingCreate(dependencies.storage, pending)

      const created = parseCreateResponse(
        await readJson(
          await dependencies.fetch('/api/duel/matches', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': pending.createRequestId,
            },
            body: JSON.stringify({
              totalRounds: pending.totalRounds,
              createRecoverySecret: pending.createRecoverySecret,
            }),
          }),
        ),
      )
      if (created.totalRounds !== pending.totalRounds) {
        throw new DuelCreateLockError('REQUEST_FAILED')
      }
      const pendingLock = persistCreatedMatchHandoff(dependencies.storage, created)
      matchId = pendingLock.matchId
      participantToken = created.participantToken
      lockPlacements = pendingLock.placements
    }

    await readJson(
      await dependencies.fetch(
        `/api/duel/matches/${encodeURIComponent(matchId)}/placements/lock`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${participantToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ placements: lockPlacements }),
        },
      ),
    )
    const state = await readJson(
      await dependencies.fetch(`/api/duel/matches/${encodeURIComponent(matchId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${participantToken}` },
      }),
    )
    if (!confirmsLock(state, matchId, input.totalRounds)) {
      throw new DuelCreateLockError('REQUEST_FAILED')
    }
    completePendingLock(dependencies.storage, matchId)
    return { matchId }
  } catch (error: unknown) {
    if (error instanceof DuelCreateLockError) throw error
    throw new DuelCreateLockError('REQUEST_FAILED')
  }
}

/** Coalesces concurrent clicks while allowing another attempt after failure. */
export function createDuelALockCoordinator(dependencies: DuelCreateLockDependencies): {
  run(input: DuelCreateLockInput): Promise<DuelCreateLockResult>
} {
  let inFlight: Promise<DuelCreateLockResult> | null = null
  return {
    run(input) {
      if (inFlight) return inFlight
      inFlight = executeCreateLock(input, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
