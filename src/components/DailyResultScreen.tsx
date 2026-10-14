import { useCallback, useEffect, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
  DailyRankingClientError,
  fetchDailyRanking,
  fetchDailySelfResult,
  type DailySelfResultView,
} from '../daily/dailyRankingClient'
import {
  classifyDailyRankingLoadFailure,
  dailyResultViewModel,
  formatDailyResultHitRate,
  type DailyResultListRow,
  type DailyResultScreenPhase,
} from '../daily/dailyResultPresentation'
import {
  readDailyParticipant,
  type DailyStorageAdapter,
} from '../daily/dailyParticipantStorage'
import { withDuelNums } from '../ui/withDuelNums'

export type DailyResultScreenProps = {
  readonly challengeDate: string
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly storage?: DailyStorageAdapter
  readonly fetch?: typeof fetch
  /** Test seam: skip network and render a fixed phase. */
  readonly initialPhase?: DailyResultScreenPhase
}

function readToken(
  challengeDate: string,
  storage: DailyStorageAdapter | undefined,
): string | null {
  try {
    const adapter =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!adapter) return null
    const record = readDailyParticipant(adapter, challengeDate)
    if (record?.phase !== 'joined') return null
    if (record.challengeDate !== challengeDate) return null
    return record.token
  } catch {
    return null
  }
}

export function DailyResultRankingTable({
  rows,
  t,
  statusMessage,
}: {
  readonly rows: readonly DailyResultListRow[]
  readonly t: AppStrings
  readonly statusMessage?: string | null
}) {
  const [totalHeading = t.groupTotalCoins, coinsHeading = ''] =
    t.groupTotalCoins.split(/\s+(?=COINS$)/)
  const [threeCoinsHeading = t.groupThreeCoinsComplete, completeHeading = ''] =
    t.groupThreeCoinsComplete.split(/\s+(?=COMPLETE$)/)
  const [coinBagHeading = t.groupCoinBagHitRate, hitRateHeading = ''] =
    t.groupCoinBagHitRate.split(/\s+(?=HIT RATE$)/)

  return (
    <div className="group-result__table">
      {statusMessage ? (
        <p className="daily-result__status" role="status">
          {statusMessage}
        </p>
      ) : null}
      <div className="group-result__cols group-result__header" aria-hidden="true">
        <span className="group-result__h-rank" />
        <span className="group-result__h-nick" />
        <span
          className="group-result__h-metric group-result__h-metric--stacked"
          aria-label={t.groupTotalCoins}
        >
          <span>{totalHeading}</span>
          <span>{coinsHeading}</span>
        </span>
        <span
          className="group-result__h-metric group-result__h-metric--stacked"
          aria-label={t.groupThreeCoinsComplete}
        >
          <span>{withDuelNums(threeCoinsHeading)}</span>
          <span>{completeHeading}</span>
        </span>
        <span
          className="group-result__h-metric group-result__h-metric--stacked group-result__h-metric--hit-rate"
          aria-label={t.groupCoinBagHitRate}
        >
          <span>{coinBagHeading}</span>
          <span>{hitRateHeading}</span>
        </span>
        {/* Details column reserved for eng9D — intentionally empty (no fake button). */}
        <span className="group-result__h-action" />
      </div>
      <ol className="group-result__ranking">
        {rows.map((entry) => (
          <li
            key={entry.key}
            className={`group-result__cols group-result__entry${entry.isSelf ? ' group-result__entry--self' : ''}`}
            aria-current={entry.isSelf ? 'true' : undefined}
            data-daily-result-self={entry.isSelf ? 'true' : undefined}
          >
            <span
              className="group-result__rank"
              aria-label={
                entry.rank === null
                  ? t.groupRank
                  : `${t.groupRank} ${entry.rank}`
              }
            >
              {entry.rank === null ? (
                <span className="duel-num">–</span>
              ) : (
                <span className="duel-num">{entry.rank}</span>
              )}
            </span>
            <span className="group-result__nickname" title={entry.nickname}>
              {entry.nickname}
            </span>
            <strong
              className="group-result__metric"
              aria-label={`${t.groupTotalCoins} ${entry.totalCoins}`}
            >
              <span className="duel-num">{entry.totalCoins}</span>
            </strong>
            <strong
              className="group-result__metric"
              aria-label={`${t.groupThreeCoinsComplete} ${entry.threeCoinsComplete}`}
            >
              <span className="duel-num">{entry.threeCoinsComplete}</span>
            </strong>
            <strong
              className="group-result__metric"
              aria-label={`${t.groupCoinBagHitRate} ${formatDailyResultHitRate(entry.coinBagHits, entry.totalOpens)}`}
            >
              {withDuelNums(
                formatDailyResultHitRate(entry.coinBagHits, entry.totalOpens),
              )}
            </strong>
            <span className="group-result__details-slot" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </div>
  )
}

export function DailyResultView({
  phase,
  t,
  onGoTop,
  onRetryRanking,
  rankingBusy,
}: {
  readonly phase: DailyResultScreenPhase
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly onRetryRanking?: () => void
  readonly rankingBusy?: boolean
}) {
  if (phase.kind === 'loading_self') {
    return (
      <div className="group-result-detail-status" role="status">
        {t.groupResultLoading}
      </div>
    )
  }

  if (phase.kind === 'self_error') {
    return (
      <section className="group-result-detail-error" role="alert">
        <p className="group-result-detail-error__copy stable-message-slot stable-message-slot--detail-error">
          {t.groupResultError}
        </p>
        <div className="group-result-detail-error__actions">
          {phase.code !== 'unauthorized' && onRetryRanking ? (
            <button
              type="button"
              className="duel-btn"
              disabled={rankingBusy}
              onClick={onRetryRanking}
            >
              {t.groupResultRetry}
            </button>
          ) : null}
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top"
            onClick={onGoTop}
          >
            {t.duelReturnToTop}
          </button>
        </div>
      </section>
    )
  }

  const model = dailyResultViewModel(phase)
  const statusMessage =
    model.statusKey === 'dailyRankingUpdatesEvery10Minutes'
      ? t.dailyRankingUpdatesEvery10Minutes
      : model.statusKey === 'groupResultError'
        ? t.groupResultError
        : null

  return (
    <section
      className="group-result daily-result"
      aria-labelledby="daily-result-title"
      data-daily-result-phase={phase.kind}
      data-daily-ranking-status={
        phase.kind === 'ready' ? phase.ranking.status : undefined
      }
    >
      <h2 id="daily-result-title" className="group-result__title">
        {t.groupResultTitle}
      </h2>
      <DailyResultRankingTable
        rows={model.rows}
        t={t}
        statusMessage={statusMessage}
      />
      <div className="daily-result__actions">
        {model.showRankingRetry ? (
          <button
            type="button"
            className="duel-btn"
            disabled={rankingBusy}
            onClick={onRetryRanking}
            data-daily-ranking-retry=""
          >
            {t.groupResultRetry}
          </button>
        ) : null}
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top group-result__top"
          onClick={onGoTop}
        >
          {t.duelReturnToTop}
        </button>
      </div>
    </section>
  )
}

function selfFromPhase(
  phase: DailyResultScreenPhase,
): DailySelfResultView | null {
  if (
    phase.kind === 'ranking_loading' ||
    phase.kind === 'ranking_pending' ||
    phase.kind === 'ranking_error' ||
    phase.kind === 'ready'
  ) {
    return phase.self
  }
  return null
}

/**
 * DAILY RESULT / RANKING list after 20 ROUNDS complete.
 * Fetches personal RESULT immediately; ranking 404 is shown as pending (not a fault).
 * Details button omitted until eng9D.
 *
 * Async loads use a cancelled flag + challengeDate captured in the effect closure
 * so late responses cannot update a different date’s screen. No render-time ref writes.
 */
export function DailyResultScreen({
  challengeDate,
  t,
  onGoTop,
  storage,
  fetch: fetchImpl,
  initialPhase,
}: DailyResultScreenProps) {
  const [phase, setPhase] = useState<DailyResultScreenPhase>(
    () => initialPhase ?? { kind: 'loading_self' },
  )
  const [rankingBusy, setRankingBusy] = useState(false)
  /** Bumped by TRY AGAIN to re-run the effect without sync setState-in-effect. */
  const [reloadNonce, setReloadNonce] = useState(0)
  const fetcher = fetchImpl ?? fetch
  const skipNetwork = initialPhase !== undefined

  useEffect(() => {
    if (skipNetwork) return

    let cancelled = false
    const expectedDate = challengeDate

    const apply = (next: DailyResultScreenPhase) => {
      if (!cancelled) setPhase(next)
    }

    const loadRankingForSelf = async (self: DailySelfResultView) => {
      const token = readToken(expectedDate, storage)
      if (!token) {
        apply({ kind: 'ranking_error', self, code: 'unauthorized' })
        return
      }
      if (!cancelled) setRankingBusy(true)
      try {
        const ranking = await fetchDailyRanking(expectedDate, token, fetcher)
        if (cancelled) return
        if (ranking.challengeDate !== expectedDate) {
          apply({ kind: 'ranking_error', self, code: 'error' })
          return
        }
        if (ranking.self.participantId !== self.participantId) {
          apply({ kind: 'ranking_error', self, code: 'error' })
          return
        }
        apply({ kind: 'ready', self, ranking })
      } catch (error: unknown) {
        if (cancelled) return
        if (error instanceof DailyRankingClientError) {
          const classified = classifyDailyRankingLoadFailure(error.code)
          if (classified === 'pending') {
            apply({ kind: 'ranking_pending', self })
            return
          }
          apply({
            kind: 'ranking_error',
            self,
            code: classified === 'unauthorized' ? 'unauthorized' : 'error',
          })
          return
        }
        apply({ kind: 'ranking_error', self, code: 'error' })
      } finally {
        if (!cancelled) setRankingBusy(false)
      }
    }

    void (async () => {
      const token = readToken(expectedDate, storage)
      if (!token) {
        apply({ kind: 'self_error', code: 'unauthorized' })
        return
      }
      // Initial phase is already loading_self — do not setState sync here.
      try {
        const self = await fetchDailySelfResult(expectedDate, token, fetcher)
        if (cancelled) return
        if (self.challengeDate !== expectedDate) {
          apply({ kind: 'self_error', code: 'error' })
          return
        }
        // Show self scores immediately; 10-min copy only after ranking 404.
        apply({ kind: 'ranking_loading', self })
        await loadRankingForSelf(self)
      } catch (error: unknown) {
        if (cancelled) return
        if (error instanceof DailyRankingClientError) {
          apply({
            kind: 'self_error',
            code: error.code === 'UNAUTHORIZED' ? 'unauthorized' : 'error',
          })
          return
        }
        apply({ kind: 'self_error', code: 'error' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [challengeDate, fetcher, reloadNonce, skipNetwork, storage])

  const retry = useCallback(() => {
    const self = selfFromPhase(phase)
    if (
      self &&
      (phase.kind === 'ranking_pending' ||
        phase.kind === 'ranking_error' ||
        phase.kind === 'ranking_loading')
    ) {
      // Keep self scores visible; effect re-fetches RESULT then ranking.
      setPhase({ kind: 'ranking_loading', self })
      setReloadNonce((value) => value + 1)
      return
    }
    setPhase({ kind: 'loading_self' })
    setReloadNonce((value) => value + 1)
  }, [phase])

  return (
    <DailyResultView
      phase={phase}
      t={t}
      onGoTop={onGoTop}
      onRetryRanking={retry}
      rankingBusy={rankingBusy}
    />
  )
}
