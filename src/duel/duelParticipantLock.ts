import type { DuelRoundPlacement } from '../game/duelPlacement'
import {
  completeParticipantBLock,
  readBRecoveryState,
  readParticipant,
  savePendingLock,
  toCanonicalDuelPlacements,
  type CanonicalDuelPlacement,
  type StorageAdapter,
} from './duelPersistence'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DuelParticipantLockErrorCode = 'RECOVERY_MISMATCH' | 'REQUEST_FAILED'

export class DuelParticipantLockError extends Error {
  readonly code: DuelParticipantLockErrorCode

  constructor(code: DuelParticipantLockErrorCode) {
    super('The DUEL match could not be locked.')
    this.name = 'DuelParticipantLockError'
    this.code = code
  }
}

export interface DuelParticipantLockInput {
  readonly matchId: string
  readonly totalRounds: number
  readonly placements: readonly DuelRoundPlacement[]
}

export interface DuelParticipantLockDependencies {
  readonly storage: StorageAdapter
  readonly fetch: typeof fetch
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

function confirmsBLock(
  value: unknown,
  matchId: string,
  totalRounds: number,
): boolean {
  return (
    isRecord(value) &&
    value.matchId === matchId &&
    value.totalRounds === totalRounds &&
    value.role === 'B' &&
    isRecord(value.self) &&
    value.self.claimed === true &&
    value.self.placementLocked === true
  )
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new DuelParticipantLockError('REQUEST_FAILED')
  try {
    return await response.json()
  } catch {
    throw new DuelParticipantLockError('REQUEST_FAILED')
  }
}

async function executeParticipantLock(
  input: DuelParticipantLockInput,
  dependencies: DuelParticipantLockDependencies,
): Promise<void> {
  try {
    const matchId = input.matchId.toLowerCase()
    if (!UUID_PATTERN.test(matchId)) {
      throw new DuelParticipantLockError('REQUEST_FAILED')
    }
    const canonical = toCanonicalDuelPlacements(input.placements, input.totalRounds)
    const recovery = readBRecoveryState(dependencies.storage, matchId)
    let participantToken: string
    let lockPlacements: readonly CanonicalDuelPlacement[]

    if (recovery.phase === 'lock-retry') {
      if (
        recovery.pending.matchId !== matchId ||
        recovery.participant.role !== 'B' ||
        recovery.participant.matchId !== matchId ||
        !samePlacements(recovery.pending.placements, canonical)
      ) {
        throw new DuelParticipantLockError('RECOVERY_MISMATCH')
      }
      participantToken = recovery.participant.token
      lockPlacements = recovery.pending.placements
    } else {
      const participant = readParticipant(dependencies.storage, matchId)
      if (participant?.role !== 'B' || participant.matchId !== matchId) {
        throw new DuelParticipantLockError('REQUEST_FAILED')
      }
      if (input.totalRounds !== input.placements.length) {
        throw new DuelParticipantLockError('REQUEST_FAILED')
      }
      savePendingLock(dependencies.storage, {
        version: 1,
        phase: 'pending-lock',
        matchId,
        placements: canonical,
      })
      participantToken = participant.token
      lockPlacements = canonical
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
    if (!confirmsBLock(state, matchId, input.totalRounds)) {
      throw new DuelParticipantLockError('REQUEST_FAILED')
    }
    completeParticipantBLock(dependencies.storage, matchId)
  } catch (error: unknown) {
    if (error instanceof DuelParticipantLockError) throw error
    throw new DuelParticipantLockError('REQUEST_FAILED')
  }
}

/** Coalesces concurrent clicks while allowing another attempt after failure. */
export function createDuelBLockCoordinator(
  dependencies: DuelParticipantLockDependencies,
): {
  run(input: DuelParticipantLockInput): Promise<void>
} {
  let inFlight: Promise<void> | null = null
  return {
    run(input) {
      if (inFlight) return inFlight
      inFlight = executeParticipantLock(input, dependencies).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
