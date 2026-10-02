import type { DuelOpenResult } from './duelPlayClient'
import type { DuelLocalOpenResult } from './duelOpponentPlacements'

/** Tracks when both prediction FX and authoritative OPEN may release input. */
export type OptimisticOpenGate = {
  fxDone: boolean
  serverDone: boolean
  failed: boolean
}

export function createOptimisticOpenGate(): OptimisticOpenGate {
  return { fxDone: false, serverDone: false, failed: false }
}

/** Marks FX finished. Returns true when input may unlock. */
export function markOptimisticFxDone(gate: OptimisticOpenGate): boolean {
  if (gate.failed) return false
  gate.fxDone = true
  return gate.serverDone
}

/** Marks server OPEN finished. Returns true when input may unlock. */
export function markOptimisticServerDone(gate: OptimisticOpenGate): boolean {
  if (gate.failed) return false
  gate.serverDone = true
  return gate.fxDone
}

export function markOptimisticFailed(gate: OptimisticOpenGate): void {
  gate.failed = true
}

export function sameLocalAndServerOpen(
  local: DuelLocalOpenResult,
  server: DuelOpenResult,
): boolean {
  return local.outcome === server.outcome && local.coinsFound === server.coinsFound
}

/** Coin FX clear-round flag from local prediction (server remains authoritative). */
export function predictsClearsRound(
  provisionalCoins: 0 | 1 | 2,
  local: DuelLocalOpenResult,
): boolean {
  return local.outcome === 'coins' && provisionalCoins + local.coinsFound >= 3
}
