/**
 * Pure presentation helpers for DAILY RESULT / RANKING list (eng9C).
 * Does not re-rank — only arranges API rows for GROUP-like display.
 */
import { formatGroupHitRate } from '../group/groupResultPresentation.js'
import type {
  DailyRankingEntryView,
  DailyRankingView,
  DailySelfResultView,
} from './dailyRankingClient.js'

export type DailyResultListRow = {
  readonly key: string
  readonly rank: number | null
  readonly nickname: string
  readonly totalCoins: number
  readonly threeCoinsComplete: number
  readonly coinBagHits: number
  readonly totalOpens: number
  readonly isSelf: boolean
}

export type DailyResultScreenPhase =
  | { readonly kind: 'loading_self' }
  | { readonly kind: 'self_error'; readonly code: 'unauthorized' | 'error' }
  /** Self RESULT is on screen; ranking request still in flight (not a 404 wait). */
  | {
      readonly kind: 'ranking_loading'
      readonly self: DailySelfResultView
    }
  /** Ranking API returned 404 ranking_unavailable — bucket wait, not a fault. */
  | {
      readonly kind: 'ranking_pending'
      readonly self: DailySelfResultView
    }
  | {
      readonly kind: 'ranking_error'
      readonly self: DailySelfResultView
      readonly code: 'unauthorized' | 'error'
    }
  | {
      readonly kind: 'ready'
      readonly self: DailySelfResultView
      readonly ranking: DailyRankingView
      /** Quiet refresh failed while keeping the last good ranking (eng9E). */
      readonly refreshError?: boolean
    }

/** Top-10 (+ self below when not in top). Server order preserved. */
export function buildDailyResultListRows(
  ranking: DailyRankingView,
): readonly DailyResultListRow[] {
  const top = ranking.topEntries.map((entry) => toRow(entry))
  if (ranking.selfInTop) return top
  return [...top, toRow(ranking.self)]
}

/** Self-only row while ranking snapshot is not yet available (404 pending). */
export function buildDailyResultPendingSelfRow(
  self: DailySelfResultView,
): DailyResultListRow {
  return {
    key: `self:${self.participantId}`,
    rank: null,
    nickname: self.nickname,
    totalCoins: self.totalCoins,
    threeCoinsComplete: self.threeCoinsComplete,
    coinBagHits: self.coinBagHits,
    totalOpens: self.totalOpens,
    isSelf: true,
  }
}

export function formatDailyResultHitRate(hits: number, opens: number): string {
  return formatGroupHitRate(hits, opens)
}

export function dailyResultRankSizeClass(rank: number | null): string {
  const digits = rank === null ? 0 : String(rank).length
  if (digits >= 5) return ' daily-result__rank--5-plus'
  if (digits === 4) return ' daily-result__rank--4'
  if (digits === 3) return ' daily-result__rank--3'
  return ''
}

export function shouldSeparateDailySelfRow(
  rows: readonly DailyResultListRow[],
  index: number,
): boolean {
  return index === 10 && rows[index]?.isSelf === true
}

function toRow(entry: DailyRankingEntryView): DailyResultListRow {
  return {
    key: entry.participantId,
    rank: entry.rank,
    nickname: entry.nickname,
    totalCoins: entry.totalCoins,
    threeCoinsComplete: entry.threeCoinsComplete,
    coinBagHits: entry.coinBagHits,
    totalOpens: entry.totalOpens,
    isSelf: entry.isSelf,
  }
}

/**
 * Classifies ranking fetch failure for UI.
 * UNAVAILABLE (404) after a finished RESULT = ranking bucket pending — not a fault.
 */
export function classifyDailyRankingLoadFailure(
  code: 'UNAUTHORIZED' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NETWORK',
): 'pending' | 'unauthorized' | 'error' {
  if (code === 'UNAVAILABLE') return 'pending'
  if (code === 'UNAUTHORIZED') return 'unauthorized'
  return 'error'
}

export type DailyResultViewModel = {
  readonly rows: readonly DailyResultListRow[]
  readonly statusKey:
    | 'none'
    | 'groupResultLoading'
    | 'dailyRankingUpdatesEvery10Minutes'
    | 'groupResultError'
  readonly showRankingRetry: boolean
  readonly showSelfScores: boolean
  readonly phaseKind: DailyResultScreenPhase['kind']
}

export type DailyResultStatusPresentation = {
  readonly titleKey:
    | 'groupResultTitle'
    | 'dailyProvisionalResultTitle'
    | 'dailyFinalResultTitle'
  readonly descriptionKey: 'dailyProvisionalResultDescription' | null
}

/** Uses only the last validated ranking API status; unknown phases stay neutral. */
export function dailyResultStatusPresentation(
  phase: DailyResultScreenPhase,
): DailyResultStatusPresentation {
  if (phase.kind !== 'ready') {
    return { titleKey: 'groupResultTitle', descriptionKey: null }
  }
  if (phase.ranking.status === 'provisional') {
    return {
      titleKey: 'dailyProvisionalResultTitle',
      descriptionKey: 'dailyProvisionalResultDescription',
    }
  }
  return { titleKey: 'dailyFinalResultTitle', descriptionKey: null }
}

/** Maps screen phase → list rows / status / retry. */
export function dailyResultViewModel(
  phase: DailyResultScreenPhase,
): DailyResultViewModel {
  if (phase.kind === 'loading_self') {
    return {
      rows: [],
      statusKey: 'groupResultLoading',
      showRankingRetry: false,
      showSelfScores: false,
      phaseKind: phase.kind,
    }
  }
  if (phase.kind === 'self_error') {
    return {
      rows: [],
      statusKey: 'groupResultError',
      showRankingRetry: phase.code !== 'unauthorized',
      showSelfScores: false,
      phaseKind: phase.kind,
    }
  }
  if (phase.kind === 'ranking_loading') {
    return {
      rows: [buildDailyResultPendingSelfRow(phase.self)],
      statusKey: 'none',
      showRankingRetry: false,
      showSelfScores: true,
      phaseKind: phase.kind,
    }
  }
  if (phase.kind === 'ranking_pending') {
    return {
      rows: [buildDailyResultPendingSelfRow(phase.self)],
      statusKey: 'dailyRankingUpdatesEvery10Minutes',
      showRankingRetry: true,
      showSelfScores: true,
      phaseKind: phase.kind,
    }
  }
  if (phase.kind === 'ranking_error') {
    return {
      rows: [buildDailyResultPendingSelfRow(phase.self)],
      statusKey: 'groupResultError',
      showRankingRetry: true,
      showSelfScores: true,
      phaseKind: phase.kind,
    }
  }
  return {
    rows: buildDailyResultListRows(phase.ranking),
    statusKey: phase.refreshError ? 'groupResultError' : 'none',
    showRankingRetry: Boolean(phase.refreshError),
    showSelfScores: true,
    phaseKind: phase.kind,
  }
}
