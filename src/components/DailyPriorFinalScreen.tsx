/**
 * Yesterday's FINAL ranking gate before today's DAILY (eng9F).
 * Reuses RESULT table + detail board; no 10-minute auto-refresh; ack only on CONTINUE.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type { DailyChallengeDate } from '../daily/dailyChallengeDate'
import {
  DailyRankingClientError,
  fetchDailyRanking,
  fetchDailySelfResult,
  type DailyRankingView,
  type DailySelfResultView,
} from '../daily/dailyRankingClient'
import {
  canAcknowledgeDailyPriorFinal,
  judgeDailyPriorFinalFetch,
} from '../daily/dailyPriorFinal'
import { saveDailyPriorFinalAck } from '../daily/dailyPriorFinalAckStorage'
import type {
  DailyStorageAdapter,
  JoinedDailyParticipantRecord,
} from '../daily/dailyParticipantStorage'
import { buildDailyResultListRows } from '../daily/dailyResultPresentation'
import { withDuelNums } from '../ui/withDuelNums'
import { DailyResultDetailScreen } from './DailyResultDetailScreen'
import { DailyResultRankingTable } from './DailyResultScreen'

export type DailyPriorFinalScreenProps = {
  readonly priorChallengeDate: DailyChallengeDate
  readonly entryChallengeDate: DailyChallengeDate
  readonly priorParticipant: JoinedDailyParticipantRecord
  readonly t: AppStrings
  readonly onGoTop: () => void
  /** After successful ack — enter today's prestart. */
  readonly onAcknowledgedContinue: () => void
  /**
   * Not eligible, or user continues past a retryable failure without ack.
   * Gate may reappear on a later DAILY entry until FINAL is confirmed.
   */
  readonly onContinueWithoutAck: () => void
  readonly storage?: DailyStorageAdapter
  readonly fetch?: typeof fetch
}

type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      readonly self: DailySelfResultView
      readonly ranking: DailyRankingView
    }
  | { readonly kind: 'waiting_final'; readonly self: DailySelfResultView }
  | { readonly kind: 'retryable'; readonly self: DailySelfResultView | null }
  | { readonly kind: 'unauthorized' }
  | {
      readonly kind: 'ack_failed'
      readonly self: DailySelfResultView
      readonly ranking: DailyRankingView
    }

export function DailyPriorFinalScreen({
  priorChallengeDate,
  entryChallengeDate,
  priorParticipant,
  t,
  onGoTop,
  onAcknowledgedContinue,
  onContinueWithoutAck,
  storage,
  fetch: fetchImpl,
}: DailyPriorFinalScreenProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const fetcher = fetchImpl ?? fetch

  const onContinueWithoutAckRef = useRef(onContinueWithoutAck)
  const fetchGenerationRef = useRef(0)
  const ackInFlightRef = useRef(false)
  useEffect(() => {
    onContinueWithoutAckRef.current = onContinueWithoutAck
  }, [onContinueWithoutAck])

  const storageAdapter =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined)

  useEffect(() => {
    let cancelled = false
    const generation = fetchGenerationRef.current + 1
    fetchGenerationRef.current = generation
    const expectedPrior = priorChallengeDate
    const expectedParticipantId = priorParticipant.participantId
    const token = priorParticipant.token

    const isCurrent = () =>
      !cancelled && fetchGenerationRef.current === generation

    void (async () => {
      setBusy(true)
      setLoad({ kind: 'loading' })

      let selfResult:
        | { kind: 'ok'; value: DailySelfResultView }
        | { kind: 'unauthorized' }
        | { kind: 'unavailable' }
        | { kind: 'error' }
      try {
        const self = await fetchDailySelfResult(expectedPrior, token, fetcher)
        if (
          self.challengeDate !== expectedPrior ||
          self.participantId !== expectedParticipantId
        ) {
          selfResult = { kind: 'unavailable' }
        } else {
          selfResult = { kind: 'ok', value: self }
        }
      } catch (error: unknown) {
        if (error instanceof DailyRankingClientError) {
          if (error.code === 'UNAUTHORIZED') selfResult = { kind: 'unauthorized' }
          else if (error.code === 'UNAVAILABLE') selfResult = { kind: 'unavailable' }
          else selfResult = { kind: 'error' }
        } else {
          selfResult = { kind: 'error' }
        }
      }

      if (!isCurrent()) return

      let rankingResult:
        | { kind: 'ok'; value: DailyRankingView }
        | { kind: 'unauthorized' }
        | { kind: 'unavailable' }
        | { kind: 'error' }
        | { kind: 'skipped' } = { kind: 'skipped' }

      if (selfResult.kind === 'ok') {
        try {
          const ranking = await fetchDailyRanking(expectedPrior, token, fetcher)
          rankingResult = { kind: 'ok', value: ranking }
        } catch (error: unknown) {
          if (error instanceof DailyRankingClientError) {
            if (error.code === 'UNAUTHORIZED') rankingResult = { kind: 'unauthorized' }
            else if (error.code === 'UNAVAILABLE') {
              rankingResult = { kind: 'unavailable' }
            } else rankingResult = { kind: 'error' }
          } else {
            rankingResult = { kind: 'error' }
          }
        }
      }

      if (!isCurrent()) return

      const verdict = judgeDailyPriorFinalFetch({
        expectedPriorDate: expectedPrior,
        expectedParticipantId,
        self: selfResult,
        ranking: rankingResult,
      })

      if (verdict.kind === 'not_eligible') {
        onContinueWithoutAckRef.current()
        return
      }
      if (verdict.kind === 'unauthorized') {
        setLoad({ kind: 'unauthorized' })
        setBusy(false)
        return
      }
      if (verdict.kind === 'waiting_final' && selfResult.kind === 'ok') {
        setLoad({ kind: 'waiting_final', self: selfResult.value })
        setBusy(false)
        return
      }
      if (verdict.kind === 'retryable_error' || verdict.kind === 'waiting_final') {
        setLoad({
          kind: 'retryable',
          self: selfResult.kind === 'ok' ? selfResult.value : null,
        })
        setBusy(false)
        return
      }
      if (canAcknowledgeDailyPriorFinal(verdict)) {
        setLoad({
          kind: 'ready',
          self: verdict.self,
          ranking: verdict.ranking,
        })
        setBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    fetcher,
    priorChallengeDate,
    priorParticipant.participantId,
    priorParticipant.token,
    reloadNonce,
  ])

  const confirmContinue = useCallback(() => {
    // Ack path only — never shared with bypass CONTINUE.
    if (load.kind !== 'ready' && load.kind !== 'ack_failed') return
    if (ackInFlightRef.current) return
    if (!storageAdapter) {
      setLoad({
        kind: 'ack_failed',
        self: load.self,
        ranking: load.ranking,
      })
      return
    }
    ackInFlightRef.current = true
    try {
      saveDailyPriorFinalAck(storageAdapter, {
        priorChallengeDate,
        entryChallengeDate,
      })
    } catch {
      ackInFlightRef.current = false
      setLoad({
        kind: 'ack_failed',
        self: load.self,
        ranking: load.ranking,
      })
      return
    }
    ackInFlightRef.current = false
    onAcknowledgedContinue()
  }, [
    entryChallengeDate,
    load,
    onAcknowledgedContinue,
    priorChallengeDate,
    storageAdapter,
  ])

  const selfForDetail =
    load.kind === 'ready' ||
    load.kind === 'ack_failed' ||
    load.kind === 'waiting_final'
      ? load.self
      : load.kind === 'retryable'
        ? load.self
        : null

  if (showDetail && selfForDetail && selfForDetail.rounds.length === 20) {
    return (
      <DailyResultDetailScreen
        detail={selfForDetail}
        t={t}
        onBackToResult={() => setShowDetail(false)}
      />
    )
  }

  if (load.kind === 'loading') {
    return (
      <div className="group-result-detail-status" role="status">
        {t.groupResultLoading}
      </div>
    )
  }

  if (load.kind === 'unauthorized') {
    return (
      <section className="group-result-detail-error" role="alert">
        <p className="group-result-detail-error__copy stable-message-slot stable-message-slot--detail-error">
          {t.groupResultError}
        </p>
        <div className="group-result-detail-error__actions">
          <button
            type="button"
            className="duel-btn"
            onClick={onContinueWithoutAck}
            data-daily-prior-final-bypass=""
          >
            {t.groupContinue}
          </button>
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

  if (load.kind === 'retryable' || load.kind === 'waiting_final') {
    const self = load.kind === 'waiting_final' ? load.self : load.self
    return (
      <section
        className="group-result daily-result daily-result--prior-final"
        aria-labelledby="daily-prior-final-title"
        data-daily-prior-final=""
        data-daily-prior-final-state={load.kind}
      >
        <h2 id="daily-prior-final-title" className="group-result__title">
          {t.groupResultTitle}
        </h2>
        <p className="daily-result__status" role="status">
          {withDuelNums(priorChallengeDate)}
        </p>
        {self ? (
          <DailyResultRankingTable
            rows={[
              {
                key: `self:${self.participantId}`,
                rank: null,
                nickname: self.nickname,
                totalCoins: self.totalCoins,
                threeCoinsComplete: self.threeCoinsComplete,
                coinBagHits: self.coinBagHits,
                totalOpens: self.totalOpens,
                isSelf: true,
              },
            ]}
            t={t}
            statusMessage={
              load.kind === 'waiting_final'
                ? t.dailyRankingUpdatesEvery10Minutes
                : t.groupResultError
            }
            onOpenSelfDetails={
              self.rounds.length === 20 ? () => setShowDetail(true) : undefined
            }
          />
        ) : (
          <p className="daily-result__status" role="alert">
            {t.groupResultError}
          </p>
        )}
        <div className="daily-result__actions">
          <button
            type="button"
            className="duel-btn"
            disabled={busy}
            onClick={() => setReloadNonce((n) => n + 1)}
            data-daily-prior-final-retry=""
          >
            {t.groupResultRetry}
          </button>
          <button
            type="button"
            className="duel-btn"
            onClick={onContinueWithoutAck}
            data-daily-prior-final-bypass=""
          >
            {t.groupContinue}
          </button>
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

  // ready | ack_failed — TOTAL TIME intentionally omitted
  const rows = buildDailyResultListRows(load.ranking)
  return (
    <section
      className="group-result daily-result daily-result--prior-final"
      aria-labelledby="daily-prior-final-title"
      data-daily-prior-final=""
      data-daily-prior-final-state={load.kind}
      data-daily-ranking-status="final"
    >
      <h2 id="daily-prior-final-title" className="group-result__title">
        {t.groupResultTitle}
      </h2>
      <p className="daily-result__status" role="status">
        {withDuelNums(priorChallengeDate)}
      </p>
      {load.kind === 'ack_failed' ? (
        <p className="daily-result__status" role="alert">
          {t.dailyStorageReadError}
        </p>
      ) : null}
      <DailyResultRankingTable
        rows={rows}
        t={t}
        statusMessage={null}
        onOpenSelfDetails={
          load.self.rounds.length === 20 ? () => setShowDetail(true) : undefined
        }
      />
      <div className="daily-result__actions">
        {load.kind === 'ack_failed' ? (
          <>
            <button
              type="button"
              className="duel-btn"
              onClick={confirmContinue}
              data-daily-prior-final-retry-ack=""
            >
              {t.groupResultRetry}
            </button>
            <button
              type="button"
              className="duel-btn"
              onClick={onContinueWithoutAck}
              data-daily-prior-final-bypass=""
            >
              {t.groupContinue}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="duel-btn"
            onClick={confirmContinue}
            data-daily-prior-final-continue=""
          >
            {t.groupContinue}
          </button>
        )}
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
