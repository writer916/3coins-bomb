import type { BagContents } from './hand'

/** Cumulative SOLO stats — settled ROUNDs only. Never holds in-progress ROUND data. */
export type SoloStats = {
  readonly rounds: number
  readonly capturedCoins: number
  /** Settled ROUNDs where all 3 coins were captured. */
  readonly threeCoinsComplete: number
  readonly openedBags: number
  readonly coinBags: number
  readonly bombs: number
}

/** Per-ROUND provisional bag tallies (not persisted). */
export type SoloRoundDraft = {
  readonly openedBags: number
  readonly coinBags: number
  readonly bombs: number
}

export const INITIAL_SOLO_STATS: SoloStats = {
  rounds: 0,
  capturedCoins: 0,
  threeCoinsComplete: 0,
  openedBags: 0,
  coinBags: 0,
  bombs: 0,
}

export const INITIAL_SOLO_ROUND_DRAFT: SoloRoundDraft = {
  openedBags: 0,
  coinBags: 0,
  bombs: 0,
}

export type SoloRoundResult =
  | { readonly kind: 'bombed' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'cashed-out'; readonly capturedCoins: 1 | 2 }

export type CommitRoundResult =
  | { readonly ok: true; readonly stats: SoloStats }
  | { readonly ok: false; readonly reason: 'already-committed'; readonly stats: SoloStats }

export function createInitialSoloStats(): SoloStats {
  return { ...INITIAL_SOLO_STATS }
}

export function createInitialSoloRoundDraft(): SoloRoundDraft {
  return { ...INITIAL_SOLO_ROUND_DRAFT }
}

export function resetSoloStats(): SoloStats {
  return createInitialSoloStats()
}

export function resetSoloRoundDraft(): SoloRoundDraft {
  return createInitialSoloRoundDraft()
}

/**
 * Record one accepted bag open into the current ROUND draft only.
 * Never mutates cumulative SoloStats. Never used for REVEAL.
 */
export function applyAcceptedOpenToDraft(
  draft: SoloRoundDraft,
  contents: BagContents,
): SoloRoundDraft {
  const openedBags = draft.openedBags + 1
  if (contents.kind === 'empty') {
    return { ...draft, openedBags }
  }
  if (contents.kind === 'coins') {
    return { ...draft, openedBags, coinBags: draft.coinBags + 1 }
  }
  return { ...draft, openedBags, bombs: draft.bombs + 1 }
}

function capturedCoinsForResult(result: SoloRoundResult): number {
  if (result.kind === 'bombed') return 0
  if (result.kind === 'cleared') return 3
  return result.capturedCoins
}

/**
 * Fold one settled ROUND (draft + result) into cumulative stats once.
 * Caller must pass `alreadyCommitted=true` after the first successful commit.
 */
export function commitRoundResultToStats(
  stats: SoloStats,
  draft: SoloRoundDraft,
  result: SoloRoundResult,
  alreadyCommitted: boolean,
): CommitRoundResult {
  if (alreadyCommitted) {
    return { ok: false, reason: 'already-committed', stats }
  }

  const capturedCoins = capturedCoinsForResult(result)

  return {
    ok: true,
    stats: {
      rounds: stats.rounds + 1,
      capturedCoins: stats.capturedCoins + capturedCoins,
      threeCoinsComplete: stats.threeCoinsComplete + (capturedCoins === 3 ? 1 : 0),
      openedBags: stats.openedBags + draft.openedBags,
      coinBags: stats.coinBags + draft.coinBags,
      bombs: stats.bombs + draft.bombs,
    },
  }
}

/**
 * HIT RATE = settled coinBags / settled openedBags.
 * Returns null when no bags opened (safe — no NaN).
 */
export function calculateHitRate(stats: SoloStats): number | null {
  if (stats.openedBags <= 0) return null
  return stats.coinBags / stats.openedBags
}

export function isNonNegInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && Number.isFinite(n)
}

/** Clamp / repair a partial object into a valid SoloStats (never throws). */
export function normalizeSoloStats(raw: unknown): SoloStats {
  if (!raw || typeof raw !== 'object') return createInitialSoloStats()
  const o = raw as Record<string, unknown>
  const rounds = isNonNegInt(o.rounds) ? o.rounds : 0
  const capturedCoins = isNonNegInt(o.capturedCoins) ? o.capturedCoins : 0
  const threeCoinsComplete = isNonNegInt(o.threeCoinsComplete)
    ? Math.min(o.threeCoinsComplete, rounds)
    : 0
  const openedBags = isNonNegInt(o.openedBags) ? o.openedBags : 0
  const coinBags = isNonNegInt(o.coinBags) ? o.coinBags : 0
  const bombs = isNonNegInt(o.bombs) ? o.bombs : 0
  const safeCoinBags = Math.min(coinBags, openedBags)
  const safeBombs = Math.min(bombs, openedBags)
  return {
    rounds,
    capturedCoins,
    threeCoinsComplete,
    openedBags,
    coinBags: safeCoinBags,
    bombs: safeBombs,
  }
}

export const SOLO_STATS_STORAGE_KEY = '3cb.soloStats'
export const SOLO_STATS_SCHEMA_VERSION = 1

export type SoloStatsStoredV1 = {
  readonly v: typeof SOLO_STATS_SCHEMA_VERSION
  readonly rounds: number
  readonly capturedCoins: number
  readonly threeCoinsComplete: number
  readonly openedBags: number
  readonly coinBags: number
  readonly bombs: number
}

export function serializeSoloStats(stats: SoloStats): string {
  const body: SoloStatsStoredV1 = {
    v: SOLO_STATS_SCHEMA_VERSION,
    rounds: stats.rounds,
    capturedCoins: stats.capturedCoins,
    threeCoinsComplete: stats.threeCoinsComplete,
    openedBags: stats.openedBags,
    coinBags: stats.coinBags,
    bombs: stats.bombs,
  }
  return JSON.stringify(body)
}

/** Parse storage JSON. Corrupt / unknown → initial zeros. Never throws. */
export function deserializeSoloStats(raw: string | null | undefined): SoloStats {
  if (raw === null || raw === undefined || raw === '') {
    return createInitialSoloStats()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return createInitialSoloStats()
    const o = parsed as Record<string, unknown>
    if (o.v !== undefined && o.v !== SOLO_STATS_SCHEMA_VERSION) {
      return createInitialSoloStats()
    }
    return normalizeSoloStats(o)
  } catch {
    return createInitialSoloStats()
  }
}

function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function readSoloStats(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): SoloStats {
  if (!storage) return createInitialSoloStats()
  try {
    return deserializeSoloStats(storage.getItem(SOLO_STATS_STORAGE_KEY))
  } catch {
    return createInitialSoloStats()
  }
}

/** Persist settled cumulative stats only — never ROUND draft. */
export function writeSoloStats(
  stats: SoloStats,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(SOLO_STATS_STORAGE_KEY, serializeSoloStats(stats))
  } catch {
    // Quota / private mode — keep in-memory only.
  }
}

export function clearSoloStatsStorage(
  storage: Pick<Storage, 'removeItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(SOLO_STATS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
