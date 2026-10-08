import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
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
import { DuelPlacementWait } from './DuelPlacementWait'
import { DuelPlayScreen } from './DuelPlayScreen'
import { DuelStartConfirm } from './DuelStartConfirm'

type DuelInvitePanelProps = {
  readonly matchId: string
  readonly t: AppStrings
  readonly onGoTop?: () => void
  readonly storage?: StorageAdapter
  readonly origin?: string
}

type Feedback = 'idle' | 'copied' | 'copy-failed' | 'share-failed'
type InvitePage = 'opponent' | 'self'

type MatchMeta = {
  readonly createdAt: string
  readonly totalRounds: number
}

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

function parseMatchMeta(value: unknown, matchId: string): MatchMeta | null {
  if (!isRecord(value)) return null
  if (value.matchId !== matchId) return null
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) {
    return null
  }
  if (typeof value.totalRounds !== 'number' || !Number.isInteger(value.totalRounds)) {
    return null
  }
  if (value.totalRounds < 1) return null
  return { createdAt: value.createdAt, totalRounds: value.totalRounds }
}

function InviteCopyIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg
        className="duel-invite-copy-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M9.55 17.3 4.8 12.55l1.4-1.4 3.35 3.35 8.25-8.25 1.4 1.4z"
        />
      </svg>
    )
  }
  return (
    <svg
      className="duel-invite-copy-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M9 3h9a2 2 0 0 1 2 2v11h-2V5H9V3zm-4 4h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h9V9H5z"
      />
    </svg>
  )
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
  /* Joined is polled for bookkeeping; wait UI no longer branches on it. */
  const [, setJoined] = useState(false)
  const [playReady, setPlayReady] = useState(false)
  const [matchMeta, setMatchMeta] = useState<MatchMeta | null>(null)
  /** Session-only: explicit exit from opponent→self URL wizard. */
  const [inviteWizardFinished, setInviteWizardFinished] = useState(false)
  /** Session-only: this participant pressed START DUEL. */
  const [startedPlay, setStartedPlay] = useState(false)

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

  const pollSettled = playReady && matchMeta != null

  useEffect(() => {
    if (!storage || pollSettled) return
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
        const meta = parseMatchMeta(body, matchId)
        if (meta) setMatchMeta(meta)
        if (opponentClaimed(body, matchId)) setJoined(true)
        if (isDuelPlayReady(body, matchId)) setPlayReady(true)
      } catch {
        /* invite UI remains available when GET is unavailable */
      } finally {
        refreshPending = false
      }
    }
    const onFocus = () => {
      void refresh()
    }
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
  }, [storage, matchId, pollSettled])

  const activeUrl = page === 'opponent' ? inviteUrl : selfUrl

  const onCopy = useCallback(async () => {
    if (!activeUrl) {
      setFeedback('copy-failed')
      return
    }
    const result = await copyDuelInviteUrl(activeUrl)
    setFeedback(result === 'copied' ? 'copied' : 'copy-failed')
  }, [activeUrl])

  // Same UX as dokodesho: always show 共有; Web Share when available, else copy.
  const onShare = useCallback(async () => {
    if (!activeUrl) {
      setFeedback('share-failed')
      return
    }
    const result = await shareDuelInviteUrl(activeUrl, t.brandTitle)
    if (result === 'shared' || result === 'cancelled') return
    const copied = await copyDuelInviteUrl(activeUrl)
    setFeedback(copied === 'copied' ? 'copied' : 'share-failed')
  }, [activeUrl, t.brandTitle])

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

  const onFinishInviteWizard = useCallback(() => {
    setInviteWizardFinished(true)
    setQrOpen(false)
    setQrSvg(null)
    setFeedback('idle')
  }, [])

  const onStartDuel = useCallback(() => {
    setStartedPlay(true)
  }, [])

  if (startedPlay) {
    return <DuelPlayScreen matchId={matchId} t={t} onGoTop={onGoTop} />
  }

  // Full invite wizard (opponent → self URLs). While this UI is up, keep polling
  // joined/playReady but never displace the wizard for B claim/LOCK.
  const hasWizardUrls = Boolean(inviteUrl && selfUrl)
  const inInviteWizard = hasWizardUrls && !inviteWizardFinished

  // Normal A flow: after explicit wizard exit, wait or start-confirm (never auto-PLAY).
  if (inviteWizardFinished) {
    if (playReady && matchMeta) {
      return (
        <DuelStartConfirm
          createdAt={matchMeta.createdAt}
          totalRounds={matchMeta.totalRounds}
          t={t}
          onStart={onStartDuel}
          onGoTop={onGoTop}
        />
      )
    }
    return <DuelPlacementWait t={t} onGoTop={onGoTop} />
  }

  // Degraded wait (no invite plaintext): both LOCK → start-confirm (0 OPEN resume
  // for #p revisit is handled by locked-resume bootstrap; this covers in-session
  // B LOCK while A is on the degraded waiting UI).
  if (playReady && !inInviteWizard && !hasWizardUrls && matchMeta) {
    return (
      <DuelStartConfirm
        createdAt={matchMeta.createdAt}
        totalRounds={matchMeta.totalRounds}
        t={t}
        onStart={onStartDuel}
        onGoTop={onGoTop}
      />
    )
  }

  // Resume / degraded wait: participant auth exists but invitation plaintext does not
  // (e.g. A #p= on a new device). Keep polling; do not mint a new invite token.
  // UI matches wizard-finished wait (joined is bookkeeping only).
  if (!inviteUrl && selfUrl) {
    return <DuelPlacementWait t={t} onGoTop={onGoTop} />
  }

  if (!inviteUrl || !selfUrl) {
    return <DuelPlacementWait t={t} onGoTop={onGoTop} />
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
  const copied = feedback === 'copied'

  return (
    <div className="duel-flow duel-flow--locked duel-flow--invite">
      <div className="duel-invite-page">
        <h2 className="duel-invite-label">{label}</h2>
        <p className="duel-invite-note">{intro}</p>
        <div className="duel-invite-url-bar">
          <p className="duel-invite-url-text" title={activeUrl!}>
            {displayUrl}
          </p>
          <button
            type="button"
            className={
              copied
                ? 'duel-invite-copy duel-invite-copy--done'
                : 'duel-invite-copy'
            }
            aria-label={t.duelInviteCopyAria}
            title={t.duelInviteCopy}
            onClick={() => {
              void onCopy()
            }}
          >
            <InviteCopyIcon done={copied} />
          </button>
        </div>
        <div className="duel-invite-actions">
          <button
            type="button"
            className="duel-btn"
            onClick={() => {
              void onShare()
            }}
          >
            {t.duelInviteShare}
          </button>
          {page === 'opponent' ? (
            <button type="button" className="duel-btn" onClick={onOpenQr}>
              {t.duelInviteQr}
            </button>
          ) : onGoTop ? (
            <button type="button" className="duel-btn" onClick={onGoTop}>
              {t.duelReturnToTop}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
        <p
          className="duel-invite-feedback stable-message-slot stable-message-slot--feedback"
          role={
            feedback === 'copied'
              ? 'status'
              : feedbackText
                ? 'alert'
                : 'status'
          }
        >
          {feedbackText ?? '\u00a0'}
        </p>
        <button
          type="button"
          className="duel-btn duel-btn--invite-next"
          data-duel-metric="primary"
          onClick={page === 'opponent' ? onNext : onFinishInviteWizard}
        >
          {t.duelInviteNext}
        </button>
      </div>
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
