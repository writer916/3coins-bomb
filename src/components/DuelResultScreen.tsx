import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DuelFinalResult,
  DuelMatchDetail,
  DuelResultParticipantSummary,
} from '../duel/duelPlayClient'
import {
  buildDuelMatchDetailView,
  type DuelMatchDetailView,
} from '../duel/duelMatchDetailPresentation'
import { resolveDuelResultPresentation } from '../duel/duelResultPresentation'
import type { AppStrings } from '../i18n'
import { ensureHomeInstallListening } from '../pwa/homeInstall'
import { useHomeInstallCta } from '../pwa/useHomeInstallCta'
import { BrandTitle } from '../ui/BrandTitle'
import { withDuelNums } from '../ui/withDuelNums'
import { DuelMatchDetailScreen } from './DuelMatchDetailScreen'

ensureHomeInstallListening()

export const DUEL_RESULT_POLL_INTERVAL_MS = 5_000

type DuelResultScreenProps = {
  readonly matchId: string
  readonly initialResult: DuelFinalResult
  readonly fetchResult: () => Promise<DuelFinalResult>
  /** Completed-only match detail. Called on “VIEW DETAILS”, not on RESULT mount. */
  readonly fetchDetail: () => Promise<DuelMatchDetail>
  readonly t: AppStrings
  /**
   * Same-session PLAY RESULT click already expressed reveal intent.
   * Only honored when initialResult.status === 'completed'.
   * Waiting / resume / bootstrap leave this unset (false).
   */
  readonly initialRevealed?: boolean
  /** Final RESULT exit only. Waiting / result-ready never show TOP. */
  readonly onGoTop?: () => void
}

type DetailPane =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: DuelMatchDetailView }
  | { readonly kind: 'error' }

function StatRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: number
}) {
  return (
    <p className="duel-final-stat">
      <span>{withDuelNums(label)}</span>
      <strong>
        <span className="duel-num">{value}</span>
      </strong>
    </p>
  )
}

function PlayerCard({
  title,
  summary,
  t,
}: {
  readonly title: string
  readonly summary: DuelResultParticipantSummary
  readonly t: AppStrings
}) {
  return (
    <div className="duel-final-player">
      <h3>{title}</h3>
      <div className="duel-final-stats">
        <StatRow label={t.duelTotalCoins} value={summary.totalCapturedCoins} />
        <StatRow label={t.duelThreeCoinsComplete} value={summary.threeCoinsComplete} />
        <StatRow label={t.duelBombsHit} value={summary.bombsHit} />
      </div>
    </div>
  )
}

function CompletedResult({
  result,
  t,
  onGoTop,
  onViewDetails,
  detailBusy,
}: {
  readonly result: Extract<DuelFinalResult, { status: 'completed' }>
  readonly t: AppStrings
  readonly onGoTop?: () => void
  readonly onViewDetails: () => void
  readonly detailBusy: boolean
}) {
  const self = result.participants[result.viewerRole]
  const opponentRole = result.viewerRole === 'A' ? 'B' : 'A'
  const opponent = result.participants[opponentRole]
  const verdict = result.winner === 'draw'
    ? t.duelDraw
    : result.winner === result.viewerRole ? t.duelWin : t.duelLose
  const { showCta, guideOpen, guideKind, onAddClick, closeGuide } = useHomeInstallCta()
  const guideCopy =
    guideKind === 'ios'
      ? t.duelAddToHomeGuideIos
      : guideKind === 'android'
        ? t.duelAddToHomeGuideAndroid
        : t.duelAddToHomeGuideGeneric

  return (
    <section className="duel-final duel-final--completed">
      <div className="duel-final-body">
        <BrandTitle title={t.brandTitle} className="brand-title duel-final-brand" />
        <p className="duel-final-kicker">{t.duelResult}</p>
        <h2 className="duel-final-verdict">{verdict}</h2>
        <div className="duel-final-scores">
          <PlayerCard title={t.duelYou} summary={self} t={t} />
          <PlayerCard title={t.duelOpponent} summary={opponent} t={t} />
        </div>
      </div>
      <div className="duel-final-actions">
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top duel-final-view-details"
          data-duel-metric="primary"
          disabled={detailBusy}
          onClick={onViewDetails}
        >
          {t.duelViewDetails}
        </button>
        {onGoTop ? (
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top duel-final-return"
            data-duel-metric="secondary"
            onClick={onGoTop}
          >
            {t.duelReturnToTop}
          </button>
        ) : null}
        {showCta ? (
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top duel-final-home-install"
            data-duel-metric="tertiary"
            onClick={onAddClick}
          >
            {t.duelAddToHomeScreen}
          </button>
        ) : null}
      </div>
      {guideOpen ? (
        <div
          className="duel-home-install-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t.duelAddToHomeScreen}
          onClick={closeGuide}
        >
          <div
            className="duel-home-install-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="duel-home-install-copy">{guideCopy}</p>
            <button type="button" className="duel-btn" onClick={closeGuide}>
              {t.duelAddToHomeGuideClose}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Shared completion shell: heading stays; body slot swaps waiting copy ↔ reveal CTA.
 * No TOP on waiting / result-ready (exit lives on final RESULT only).
 */
function CompletionShell({
  t,
  mode,
  onReveal,
}: {
  readonly t: AppStrings
  readonly mode: 'waiting' | 'ready'
  readonly onReveal?: () => void
}) {
  return (
    <section
      className={
        mode === 'waiting'
          ? 'duel-final duel-final--completion duel-final--waiting'
          : 'duel-final duel-final--completion duel-final--ready'
      }
      aria-live="polite"
    >
      <p className="duel-final-kicker">{t.duelWaitingTitle}</p>
      <div className="duel-final-completion-slot">
        {mode === 'waiting' ? (
          <p className="duel-final-copy">{t.duelWaitingBody}</p>
        ) : (
          <button
            type="button"
            className="duel-btn duel-btn--primary duel-final-view"
            data-duel-metric="primary"
            onClick={onReveal}
          >
            {t.duelViewResult}
          </button>
        )}
      </div>
    </section>
  )
}

function DetailLoading({ t }: { readonly t: AppStrings }) {
  return (
    <div className="duel-match-detail-status" role="status">
      {t.duelMatchDetailLoading}
    </div>
  )
}

function DetailError({
  t,
  onRetry,
  onBackToResult,
  busy,
}: {
  readonly t: AppStrings
  readonly onRetry: () => void
  readonly onBackToResult: () => void
  readonly busy: boolean
}) {
  return (
    <section className="duel-match-detail-error" role="alert">
      <p className="duel-match-detail-error__copy stable-message-slot stable-message-slot--detail-error">
        {t.duelMatchDetailError}
      </p>
      <div className="duel-match-detail-error__actions">
        <button
          type="button"
          className="duel-btn"
          data-duel-metric="primary"
          disabled={busy}
          onClick={onRetry}
        >
          {t.duelMatchDetailRetry}
        </button>
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top duel-match-detail__back"
          data-duel-metric="secondary"
          onClick={onBackToResult}
        >
          {t.duelBackToResult}
        </button>
      </div>
    </section>
  )
}

export function DuelResultScreen({
  matchId,
  initialResult,
  fetchResult,
  fetchDetail,
  t,
  initialRevealed = false,
  onGoTop,
}: DuelResultScreenProps) {
  const [result, setResult] = useState<DuelFinalResult>(initialResult)
  const [revealed, setRevealed] = useState(
    () => initialRevealed === true && initialResult.status === 'completed',
  )
  const [detailPane, setDetailPane] = useState<DetailPane>({ kind: 'closed' })
  const [detailBusy, setDetailBusy] = useState(false)
  const fetchResultRef = useRef(fetchResult)
  fetchResultRef.current = fetchResult
  const fetchDetailRef = useRef(fetchDetail)
  fetchDetailRef.current = fetchDetail
  const detailInFlightRef = useRef(false)
  const cachedDetailRef = useRef<DuelMatchDetailView | null>(null)

  const phase = resolveDuelResultPresentation(matchId, result, revealed)

  useEffect(() => {
    if (phase !== 'waiting-for-opponent-complete') return

    let active = true
    let inFlight = false

    const refresh = async () => {
      if (!active || inFlight) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      inFlight = true
      try {
        const next = await fetchResultRef.current()
        if (!active) return
        setResult(next)
      } catch {
        /* keep waiting; one network error must not tear down the screen */
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, DUEL_RESULT_POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      active = false
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phase, matchId])

  const onReveal = useCallback(() => {
    if (result.status !== 'completed') return
    setRevealed(true)
  }, [result])

  const loadDetail = useCallback(async () => {
    if (detailInFlightRef.current) return
    detailInFlightRef.current = true
    setDetailBusy(true)
    setDetailPane({ kind: 'loading' })
    try {
      const detail = await fetchDetailRef.current()
      if (result.status !== 'completed') throw new Error('DUEL result is incomplete.')
      const view = buildDuelMatchDetailView(detail, result)
      cachedDetailRef.current = view
      setDetailPane({ kind: 'ready', detail: view })
    } catch {
      setDetailPane({ kind: 'error' })
    } finally {
      detailInFlightRef.current = false
      setDetailBusy(false)
    }
  }, [result])

  const openDetails = useCallback(() => {
    if (detailInFlightRef.current) return
    const cached = cachedDetailRef.current
    if (cached) {
      setDetailPane({ kind: 'ready', detail: cached })
      return
    }
    void loadDetail()
  }, [loadDetail])

  const closeDetails = useCallback(() => {
    setDetailPane({ kind: 'closed' })
  }, [])

  if (phase === 'waiting-for-opponent-complete') {
    return <CompletionShell t={t} mode="waiting" />
  }

  if (phase === 'result-ready') {
    return <CompletionShell t={t} mode="ready" onReveal={onReveal} />
  }

  if (result.status !== 'completed') {
    return <CompletionShell t={t} mode="waiting" />
  }

  if (detailPane.kind === 'loading') {
    return <DetailLoading t={t} />
  }

  if (detailPane.kind === 'error') {
    return (
      <DetailError
        t={t}
        busy={detailBusy}
        onRetry={() => {
          void loadDetail()
        }}
        onBackToResult={closeDetails}
      />
    )
  }

  if (detailPane.kind === 'ready') {
    return (
      <DuelMatchDetailScreen
        detail={detailPane.detail}
        t={t}
        onBackToResult={closeDetails}
      />
    )
  }

  return (
    <CompletedResult
      result={result}
      t={t}
      onGoTop={onGoTop}
      onViewDetails={openDetails}
      detailBusy={detailBusy}
    />
  )
}
