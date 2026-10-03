import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
  canUseWebShare,
  copyDuelInviteUrl,
  DuelInviteActionError,
  formatDuelShareUrlForDisplay,
  readDuelInviteUrl,
  readDuelParticipantCapabilityUrl,
  renderDuelInviteQrSvg,
  shareDuelInviteUrl,
} from '../duel/duelInviteActions'
import { readParticipant, type StorageAdapter } from '../duel/duelPersistence'
import { isDuelPlayReady } from '../duel/duelPlayCoordinator'
import { DuelPlayScreen } from './DuelPlayScreen'

type DuelInvitePanelProps = {
  readonly matchId: string
  readonly t: AppStrings
  readonly onGoTop?: () => void
  readonly storage?: StorageAdapter
  readonly origin?: string
}

type Feedback = 'idle' | 'copied' | 'copy-failed' | 'share-failed'
type InvitePage = 'opponent' | 'self'

const DUEL_READY_POLL_INTERVAL_MS = 5_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function opponentClaimed(value: unknown, matchId: string): boolean {
  if (!isRecord(value)) return false
  if (value.matchId !== matchId || value.role !== 'A') return false
  if (!isRecord(value.opponent)) return false
  return value.opponent.claimed === true
}

export function DuelInvitePanel({
  matchId,
  t,
  onGoTop,
  storage = typeof window !== 'undefined' ? window.localStorage : undefined,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
}: DuelInvitePanelProps) {
  const [page, setPage] = useState<InvitePage>('opponent')
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [playReady, setPlayReady] = useState(false)
  const shareAvailable = useMemo(() => canUseWebShare(), [])

  const inviteUrl = useMemo(() => {
    if (!storage || !origin) return null
    try {
      return readDuelInviteUrl(storage, matchId, origin)
    } catch {
      return null
    }
  }, [storage, matchId, origin])

  const selfUrl = useMemo(() => {
    if (!storage || !origin) return null
    try {
      return readDuelParticipantCapabilityUrl(storage, matchId, origin)
    } catch {
      return null
    }
  }, [storage, matchId, origin])

  useEffect(() => {
    if (!storage || playReady) return
    let active = true
    let refreshPending = false
    const participant = readParticipant(storage, matchId)
    if (participant?.role !== 'A') return
    const refresh = async () => {
      if (!active || refreshPending) return
      refreshPending = true
      try {
        const response = await fetch(
          `/api/duel/matches/${encodeURIComponent(matchId)}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${participant.token}` },
          },
        )
        if (!response.ok) return
        const body: unknown = await response.json()
        if (!active) return
        if (opponentClaimed(body, matchId)) setJoined(true)
        if (isDuelPlayReady(body, matchId)) setPlayReady(true)
      } catch {
        /* invite UI remains available when GET is unavailable */
      } finally {
        refreshPending = false
      }
    }
    const onFocus = () => { void refresh() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, DUEL_READY_POLL_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(pollTimer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [storage, matchId, playReady])

  const activeUrl = page === 'opponent' ? inviteUrl : selfUrl

  const onCopy = useCallback(async () => {
    if (!activeUrl) {
      setFeedback('copy-failed')
      return
    }
    const result = await copyDuelInviteUrl(activeUrl)
    setFeedback(result === 'copied' ? 'copied' : 'copy-failed')
  }, [activeUrl])

  const onShare = useCallback(async () => {
    if (!activeUrl || !shareAvailable) return
    const result = await shareDuelInviteUrl(activeUrl, t.brandTitle)
    if (result === 'failed') setFeedback('share-failed')
  }, [activeUrl, shareAvailable, t.brandTitle])

  const onOpenQr = useCallback(() => {
    if (!inviteUrl) {
      setFeedback('copy-failed')
      return
    }
    try {
      setQrSvg(renderDuelInviteQrSvg(inviteUrl))
      setQrOpen(true)
    } catch (error: unknown) {
      if (!(error instanceof DuelInviteActionError)) {
        /* swallow */
      }
      setFeedback('copy-failed')
    }
  }, [inviteUrl])

  const onCloseQr = useCallback(() => {
    setQrOpen(false)
    setQrSvg(null)
  }, [])

  const onNext = useCallback(() => {
    setPage('self')
    setQrOpen(false)
    setQrSvg(null)
    setFeedback('idle')
  }, [])

  if (playReady) {
    return <DuelPlayScreen matchId={matchId} t={t} />
  }

  if (!inviteUrl || !selfUrl) {
    return (
      <div className="duel-flow duel-flow--locked">
        <div className="duel-status-slot" aria-hidden="true" />
        <p className="duel-locked-label">{t.duelPlacementsLocked}</p>
      </div>
    )
  }

  if (joined) {
    return (
      <div className="duel-flow duel-flow--locked">
        <div className="duel-status-slot" aria-hidden="true" />
        <p className="duel-locked-label">{t.duelPlacementsLocked}</p>
        <p className="duel-invite-note">{t.duelInviteOpponentJoined}</p>
      </div>
    )
  }

  const feedbackText =
    feedback === 'copied'
      ? t.duelInviteCopied
      : feedback === 'copy-failed'
        ? t.duelInviteCopyFailed
        : feedback === 'share-failed'
          ? t.duelInviteShareFailed
          : null

  const label = page === 'opponent' ? t.duelInviteUrlLabel : t.duelSelfUrlLabel
  const intro =
    page === 'opponent' ? t.duelInviteOpponentIntro : t.duelSelfUrlIntro
  const displayUrl = formatDuelShareUrlForDisplay(activeUrl!)

  return (
    <div className="duel-flow duel-flow--locked duel-flow--invite">
      <div className="duel-status-slot" aria-hidden="true" />
      <p className="duel-locked-label">{t.duelPlacementsLocked}</p>
      <p className="duel-invite-label">{label}</p>
      <p className="duel-invite-note">{intro}</p>
      <p className="duel-invite-url" title={label}>
        {displayUrl}
      </p>
      <div className="duel-field duel-field--actions duel-field--stack-actions">
        <div className="duel-btn-stack">
          <button type="button" className="duel-btn duel-btn--primary" onClick={onCopy}>
            {t.duelInviteCopy}
          </button>
          {shareAvailable ? (
            <button type="button" className="duel-btn" onClick={onShare}>
              {t.duelInviteShare}
            </button>
          ) : null}
          {page === 'opponent' ? (
            <button type="button" className="duel-btn" onClick={onOpenQr}>
              {t.duelInviteQr}
            </button>
          ) : (
            <button type="button" className="duel-btn" onClick={onGoTop}>
              {t.duelReturnToTop}
            </button>
          )}
        </div>
      </div>
      {feedbackText ? (
        <p
          className="duel-invite-feedback"
          role={feedback === 'copied' ? 'status' : 'alert'}
        >
          {feedbackText}
        </p>
      ) : null}
      {page === 'opponent' ? (
        <div className="duel-field duel-field--actions">
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            data-duel-metric="primary"
            onClick={onNext}
          >
            {t.duelInviteNext}
          </button>
        </div>
      ) : null}
      {qrOpen && qrSvg && page === 'opponent' ? (
        <div className="duel-invite-qr-overlay" role="dialog" aria-modal="true">
          <div className="duel-invite-qr-panel">
            <div
              className="duel-invite-qr-svg"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <button type="button" className="duel-btn" onClick={onCloseQr}>
              {t.duelInviteQrClose}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
