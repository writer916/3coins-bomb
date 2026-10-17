import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
  DailyRankingClientError,
  fetchDailyRanking,
  fetchDailySelfResult,
  type DailyRankingView,
  type DailySelfResultView,
} from '../daily/dailyRankingClient'
import {
  classifyDailyRankingLoadFailure,
  dailyResultRankSizeClass,
  dailyResultStatusPresentation,
  dailyResultViewModel,
  formatDailyResultHitRate,
  shouldSeparateDailySelfRow,
  type DailyResultListRow,
  type DailyResultScreenPhase,
} from '../daily/dailyResultPresentation'
import {
  decideDailyRankingQuietRefresh,
  msUntilNextDailyRankingRefresh,
  shouldRefreshDailyRankingOnResume,
  shouldScheduleDailyRankingAutoRefresh,
  currentDailyRankingBucketMs,
} from '../daily/dailyRankingRefresh'
import {
  readDailyParticipant,
  type DailyStorageAdapter,
} from '../daily/dailyParticipantStorage'
import { withDuelNums } from '../ui/withDuelNums'
import { DailyResultDetailScreen } from './DailyResultDetailScreen'

export type DailyResultScreenProps = {
  readonly challengeDate: string
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly storage?: DailyStorageAdapter
  readonly fetch?: typeof fetch
  /** Test seam: skip network and render a fixed phase. */
  readonly initialPhase?: DailyResultScreenPhase
  /** Test seam: injectable clock (UTC ms). */
  readonly nowMs?: () => number
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

function rankingAsOfMs(ranking: DailyRankingView): number {
  return Date.parse(ranking.rankingAsOf)
}

export function DailyResultRankingTable({
  rows,
  t,
  statusMessage,
  onOpenSelfDetails,
}: {
  readonly rows: readonly DailyResultListRow[]
  readonly t: AppStrings
  readonly statusMessage?: string | null
  readonly onOpenSelfDetails?: () => void
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
        <span className="group-result__h-action" />
      </div>
      <ol className="group-result__ranking">
        {rows.map((entry, index) => (
          <li
            key={entry.key}
            className={`group-result__cols group-result__entry${entry.isSelf ? ' group-result__entry--self' : ''}${shouldSeparateDailySelfRow(rows, index) ? ' daily-result__entry--separated-self' : ''}`}
            aria-current={entry.isSelf ? 'true' : undefined}
            data-daily-result-self={entry.isSelf ? 'true' : undefined}
          >
            <span
              className={`group-result__rank daily-result__rank${dailyResultRankSizeClass(entry.rank)}`}
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
            {entry.isSelf && onOpenSelfDetails ? (
              <button
                type="button"
                className="duel-btn duel-btn--quiet-top group-result__details"
                onClick={onOpenSelfDetails}
                data-daily-result-detail-button=""
              >
                {t.groupViewDetails}
              </button>
            ) : (
              <span className="group-result__details-slot" aria-hidden="true" />
            )}
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
  onOpenSelfDetails,
  onRetry,
  retryBusy = false,
}: {
  readonly phase: DailyResultScreenPhase
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly onOpenSelfDetails?: () => void
  readonly onRetry?: () => void
  readonly retryBusy?: boolean
}) {
  if (phase.kind === 'loading_self') {
    return (
      <div className="group-result-detail-status" role="status">
        {t.groupResultLoading}
      </div>
    )
  }

  if (phase.kind === 'self_error') {
    const canRetry = phase.code !== 'unauthorized' && onRetry != null
    return (
      <section className="group-result-detail-error" role="alert">
        <p className="group-result-detail-error__copy stable-message-slot stable-message-slot--detail-error">
          {t.groupResultError}
        </p>
        <div className="group-result-detail-error__actions">
          {canRetry ? (
            <button
              type="button"
              className="duel-btn"
              disabled={retryBusy}
              onClick={onRetry}
              data-daily-result-retry=""
            >
              {t.groupResultRetry}
            </button>
          ) : null}
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top"
            disabled={retryBusy}
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
  const statusPresentation = dailyResultStatusPresentation(phase)
  const resultTitle = t[statusPresentation.titleKey]
  const showRetry =
    model.showRankingRetry &&
    onRetry != null &&
    phase.kind !== 'ranking_pending'

  return (
    <section
      className="group-result daily-result"
      aria-labelledby="daily-result-title"
      data-daily-result-phase={phase.kind}
      data-daily-ranking-status={
        phase.kind === 'ready' ? phase.ranking.status : undefined
      }
    >
      <div className="daily-result__heading">
        <h2
          id="daily-result-title"
          className="group-result__title daily-result__title"
        >
          {resultTitle}
        </h2>
        {statusPresentation.descriptionKey ? (
          <p className="daily-result__provisional-note">
            {withDuelNums(t[statusPresentation.descriptionKey])}
          </p>
        ) : null}
      </div>
      <DailyResultRankingTable
        rows={model.rows}
        t={t}
        statusMessage={statusMessage}
        onOpenSelfDetails={onOpenSelfDetails}
      />
      <div className="daily-result__actions">
        {showRetry ? (
          <button
            type="button"
            className="duel-btn"
            disabled={retryBusy}
            onClick={onRetry}
            data-daily-result-retry=""
          >
            {t.groupResultRetry}
          </button>
        ) : null}
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top group-result__top"
          disabled={retryBusy}
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

function autoRefreshScheduleInput(phase: DailyResultScreenPhase) {
  if (phase.kind === 'ranking_error') {
    return {
      phaseKind: phase.kind,
      rankingErrorCode: phase.code,
    } as const
  }
  if (phase.kind === 'ready') {
    return {
      phaseKind: phase.kind,
      rankingStatus: phase.ranking.status,
    } as const
  }
  if (phase.kind === 'self_error') {
    return {
      phaseKind: phase.kind,
      selfErrorCode: phase.code,
    } as const
  }
  return { phaseKind: phase.kind } as const
}

/**
 * DAILY RESULT / RANKING list after 20 ROUNDS complete.
 * Fetches personal RESULT (with boards) immediately; ranking 404 is pending.
 * Self detail does not require ranking 200.
 * UTC 10-minute boundaries quietly re-fetch ranking only (eng9E).
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
  nowMs: nowMsProp,
}: DailyResultScreenProps) {
  const [phase, setPhase] = useState<DailyResultScreenPhase>(
    () => initialPhase ?? { kind: 'loading_self' },
  )
  const [showDetail, setShowDetail] = useState(false)
  const [loadGeneration, setLoadGeneration] = useState(0)
  const [retryBusy, setRetryBusy] = useState(false)
  const fetcher = fetchImpl ?? fetch
  const skipNetwork = initialPhase !== undefined
  const nowMsRef = useRef(nowMsProp)
  const phaseRef = useRef(phase)
  const rankingInFlightRef = useRef(false)
  const selfRetryInFlightRef = useRef(false)
  const lastAttemptMsRef = useRef<number | null>(null)
  const appliedAsOfMsRef = useRef<number | null>(
    initialPhase?.kind === 'ready' ? rankingAsOfMs(initialPhase.ranking) : null,
  )
  const appliedStatusRef = useRef<'provisional' | 'final' | null>(
    initialPhase?.kind === 'ready' ? initialPhase.ranking.status : null,
  )
  const stopAutoRef = useRef(
    initialPhase?.kind === 'ready' && initialPhase.ranking.status === 'final',
  )

  const readNow = useCallback(
    () => (nowMsRef.current ? nowMsRef.current() : Date.now()),
    [],
  )

  const schedulePhaseKind = phase.kind
  const scheduleRankingStatus =
    phase.kind === 'ready' ? phase.ranking.status : undefined
  const scheduleRankingErrorCode =
    phase.kind === 'ranking_error' ? phase.code : undefined

  useEffect(() => {
    nowMsRef.current = nowMsProp
  }, [nowMsProp])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

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
        stopAutoRef.current = true
        return
      }
      lastAttemptMsRef.current = readNow()
      try {
        const ranking = await fetchDailyRanking(
          expectedDate,
          token,
          fetcher,
          'immediate',
        )
        if (cancelled) return
        if (ranking.challengeDate !== expectedDate) {
          apply({ kind: 'ranking_error', self, code: 'error' })
          return
        }
        if (ranking.self.participantId !== self.participantId) {
          apply({ kind: 'ranking_error', self, code: 'error' })
          return
        }
        appliedAsOfMsRef.current = rankingAsOfMs(ranking)
        appliedStatusRef.current = ranking.status
        if (ranking.status === 'final') stopAutoRef.current = true
        apply({ kind: 'ready', self, ranking })
      } catch (error: unknown) {
        if (cancelled) return
        if (error instanceof DailyRankingClientError) {
          const classified = classifyDailyRankingLoadFailure(error.code)
          if (classified === 'pending') {
            apply({ kind: 'ranking_pending', self })
            return
          }
          if (classified === 'unauthorized') {
            stopAutoRef.current = true
            apply({ kind: 'ranking_error', self, code: 'unauthorized' })
            return
          }
          apply({ kind: 'ranking_error', self, code: 'error' })
          return
        }
        apply({ kind: 'ranking_error', self, code: 'error' })
      }
    }

    void (async () => {
      try {
        const token = readToken(expectedDate, storage)
        if (!token) {
          apply({ kind: 'self_error', code: 'unauthorized' })
          stopAutoRef.current = true
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
            if (error.code === 'UNAUTHORIZED') stopAutoRef.current = true
            return
          }
          apply({ kind: 'self_error', code: 'error' })
        }
      } finally {
        if (!cancelled) {
          selfRetryInFlightRef.current = false
          setRetryBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [challengeDate, fetcher, loadGeneration, readNow, skipNetwork, storage])

  const handleRetry = useCallback(() => {
    if (skipNetwork || selfRetryInFlightRef.current || rankingInFlightRef.current) {
      return
    }
    const current = phaseRef.current
    if (current.kind === 'self_error' && current.code !== 'unauthorized') {
      selfRetryInFlightRef.current = true
      setRetryBusy(true)
      setPhase({ kind: 'loading_self' })
      stopAutoRef.current = false
      setLoadGeneration((value) => value + 1)
      return
    }
    if (
      current.kind === 'ranking_error' &&
      current.code !== 'unauthorized'
    ) {
      const self = current.self
      const token = readToken(challengeDate, storage)
      if (!token) {
        setPhase({ kind: 'ranking_error', self, code: 'unauthorized' })
        stopAutoRef.current = true
        return
      }
      rankingInFlightRef.current = true
      setRetryBusy(true)
      setPhase({ kind: 'ranking_loading', self })
      void (async () => {
        try {
          const ranking = await fetchDailyRanking(
            challengeDate,
            token,
            fetcher,
            'immediate',
          )
          if (ranking.challengeDate !== challengeDate) {
            setPhase({ kind: 'ranking_error', self, code: 'error' })
            return
          }
          if (ranking.self.participantId !== self.participantId) {
            setPhase({ kind: 'ranking_error', self, code: 'error' })
            return
          }
          appliedAsOfMsRef.current = rankingAsOfMs(ranking)
          appliedStatusRef.current = ranking.status
          if (ranking.status === 'final') stopAutoRef.current = true
          setPhase({ kind: 'ready', self, ranking })
        } catch (error: unknown) {
          if (error instanceof DailyRankingClientError) {
            const classified = classifyDailyRankingLoadFailure(error.code)
            if (classified === 'pending') {
              setPhase({ kind: 'ranking_pending', self })
              return
            }
            if (classified === 'unauthorized') {
              stopAutoRef.current = true
              setPhase({ kind: 'ranking_error', self, code: 'unauthorized' })
              return
            }
          }
          setPhase({ kind: 'ranking_error', self, code: 'error' })
        } finally {
          rankingInFlightRef.current = false
          setRetryBusy(false)
        }
      })()
      return
    }
    if (current.kind === 'ready' && current.refreshError) {
      const self = current.self
      const token = readToken(challengeDate, storage)
      if (!token) {
        setPhase({ kind: 'ranking_error', self, code: 'unauthorized' })
        stopAutoRef.current = true
        return
      }
      rankingInFlightRef.current = true
      setRetryBusy(true)
      void (async () => {
        try {
          const ranking = await fetchDailyRanking(
            challengeDate,
            token,
            fetcher,
            'immediate',
          )
          if (ranking.challengeDate !== challengeDate) {
            setPhase({
              kind: 'ready',
              self: current.self,
              ranking: current.ranking,
              refreshError: true,
            })
            return
          }
          if (ranking.self.participantId !== self.participantId) {
            setPhase({
              kind: 'ready',
              self: current.self,
              ranking: current.ranking,
              refreshError: true,
            })
            return
          }
          appliedAsOfMsRef.current = rankingAsOfMs(ranking)
          appliedStatusRef.current = ranking.status
          if (ranking.status === 'final') stopAutoRef.current = true
          setPhase({ kind: 'ready', self, ranking })
        } catch {
          setPhase({
            kind: 'ready',
            self: current.self,
            ranking: current.ranking,
            refreshError: true,
          })
        } finally {
          rankingInFlightRef.current = false
          setRetryBusy(false)
        }
      })()
    }
  }, [challengeDate, fetcher, skipNetwork, storage])

  /**
   * Quiet ranking-only refresh on UTC boundaries / resume / limited stale retry.
   * Does not re-fetch personal RESULT or clear the detail board.
   */
  useEffect(() => {
    if (skipNetwork) return
    if (stopAutoRef.current) return
    if (
      !shouldScheduleDailyRankingAutoRefresh({
        phaseKind: schedulePhaseKind,
        rankingStatus: scheduleRankingStatus,
        rankingErrorCode: scheduleRankingErrorCode,
      })
    ) {
      return
    }

    let cancelled = false
    let timerId: ReturnType<typeof setTimeout> | null = null
    let staleRetriesUsed = 0
    const expectedDate = challengeDate

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
    }

    const scheduleBoundary = () => {
      clearTimer()
      if (cancelled || stopAutoRef.current) return
      const delay = msUntilNextDailyRankingRefresh(readNow())
      timerId = setTimeout(() => {
        void runQuietRefresh('boundary')
      }, delay)
    }

    const scheduleStaleRetry = (retryAfterMs: number) => {
      clearTimer()
      if (cancelled || stopAutoRef.current) return
      timerId = setTimeout(() => {
        void runQuietRefresh('stale')
      }, retryAfterMs)
    }

    const runQuietRefresh = async (_reason: 'boundary' | 'resume' | 'stale') => {
      if (cancelled || stopAutoRef.current) return
      if (rankingInFlightRef.current) return
      const current = phaseRef.current
      if (!shouldScheduleDailyRankingAutoRefresh(autoRefreshScheduleInput(current))) {
        return
      }
      const self = selfFromPhase(current)
      if (!self) return
      const token = readToken(expectedDate, storage)
      if (!token) {
        stopAutoRef.current = true
        setPhase({ kind: 'ranking_error', self, code: 'unauthorized' })
        return
      }

      rankingInFlightRef.current = true
      lastAttemptMsRef.current = readNow()
      // Quiet: do not flip the whole screen to LOADING.
      // After a boundary (+ safety) fire, expect the current inclusive UTC bucket.
      const expectedBucketMs = currentDailyRankingBucketMs(readNow())

      try {
        const ranking = await fetchDailyRanking(expectedDate, token, fetcher)
        if (cancelled) return

        const decision = decideDailyRankingQuietRefresh({
          phaseKind: current.kind,
          appliedRankingAsOfMs: appliedAsOfMsRef.current,
          appliedRankingStatus: appliedStatusRef.current,
          expectedBucketMs,
          staleRetriesUsed,
          response: {
            kind: 'ok',
            challengeDate: ranking.challengeDate,
            expectedChallengeDate: expectedDate,
            rankingAsOfMs: rankingAsOfMs(ranking),
            status: ranking.status,
            selfParticipantId: ranking.self.participantId,
            expectedParticipantId: self.participantId,
          },
        })

        if (decision.action === 'retry_stale') {
          staleRetriesUsed += 1
          scheduleStaleRetry(decision.retryAfterMs)
          return
        }
        staleRetriesUsed = 0
        if (decision.action === 'ignore') {
          scheduleBoundary()
          return
        }
        if (decision.action === 'apply') {
          appliedAsOfMsRef.current = rankingAsOfMs(ranking)
          appliedStatusRef.current = ranking.status
          if (decision.stopAutoRefresh) stopAutoRef.current = true
          setPhase({ kind: 'ready', self, ranking })
          if (!decision.stopAutoRefresh) scheduleBoundary()
          return
        }
      } catch (error: unknown) {
        if (cancelled) return
        let response:
          | { kind: 'unavailable' }
          | { kind: 'unauthorized' }
          | { kind: 'error' } = { kind: 'error' }
        if (error instanceof DailyRankingClientError) {
          if (error.code === 'UNAVAILABLE') response = { kind: 'unavailable' }
          else if (error.code === 'UNAUTHORIZED') response = { kind: 'unauthorized' }
        }
        const decision = decideDailyRankingQuietRefresh({
          phaseKind: current.kind,
          appliedRankingAsOfMs: appliedAsOfMsRef.current,
          appliedRankingStatus: appliedStatusRef.current,
          expectedBucketMs,
          staleRetriesUsed,
          response,
        })
        if (decision.action === 'hard_unauthorized') {
          stopAutoRef.current = true
          setPhase({ kind: 'ranking_error', self, code: 'unauthorized' })
          return
        }
        if (decision.action === 'keep_pending') {
          setPhase({ kind: 'ranking_pending', self })
          scheduleBoundary()
          return
        }
        if (decision.action === 'soft_error') {
          if (current.kind === 'ready') {
            setPhase({
              kind: 'ready',
              self: current.self,
              ranking: current.ranking,
              refreshError: true,
            })
          } else if (current.kind !== 'ranking_pending') {
            setPhase({ kind: 'ranking_error', self, code: 'error' })
          }
          // pending stays pending (404 wait is not a fault); still reschedule
          if (current.kind === 'ranking_pending') {
            setPhase({ kind: 'ranking_pending', self })
          }
          scheduleBoundary()
          return
        }
        scheduleBoundary()
      } finally {
        rankingInFlightRef.current = false
      }
    }

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      if (cancelled || stopAutoRef.current) return
      const current = phaseRef.current
      const now = readNow()
      // Drop any delayed boundary timer so resume + late wake cannot double-fire.
      clearTimer()
      if (
        shouldRefreshDailyRankingOnResume({
          nowMs: now,
          lastAttemptMs: lastAttemptMsRef.current,
          appliedRankingAsOfMs: appliedAsOfMsRef.current,
          phaseKind: current.kind,
          rankingStatus:
            current.kind === 'ready' ? current.ranking.status : undefined,
        })
      ) {
        void runQuietRefresh('resume')
        return
      }
      scheduleBoundary()
    }

    scheduleBoundary()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      clearTimer()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [
    challengeDate,
    fetcher,
    readNow,
    schedulePhaseKind,
    scheduleRankingErrorCode,
    scheduleRankingStatus,
    skipNetwork,
    storage,
  ])

  const self = selfFromPhase(phase)
  if (showDetail && self && self.rounds.length === 20) {
    return (
      <DailyResultDetailScreen
        detail={self}
        t={t}
        onBackToResult={() => setShowDetail(false)}
      />
    )
  }

  return (
    <DailyResultView
      phase={phase}
      t={t}
      onGoTop={onGoTop}
      onRetry={skipNetwork ? undefined : handleRetry}
      retryBusy={retryBusy}
      onOpenSelfDetails={
        self && self.rounds.length === 20
          ? () => setShowDetail(true)
          : undefined
      }
    />
  )
}
