import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
  canUseWebShare,
  copyDuelInviteUrl,
  DuelInviteActionError,
  readDuelInviteUrl,
  renderDuelInviteQrSvg,
  shareDuelInviteUrl,
} from '../duel/duelInviteActions'
import { readParticipant, type StorageAdapter } from '../duel/duelPersistence'
import { isDuelPlayReady } from '../duel/duelPlayCoordinator'
import { DuelPlayScreen } from './DuelPlayScreen'

type DuelInvitePanelProps = {
  readonly matchId: string
  readonly t: AppStrings
  readonly storage?: StorageAdapter
  readonly origin?: string
}

type Feedback = 'idle' | 'copied' | 'copy-failed' | 'share-failed'

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
  storage = typeof window !== 'undefined' ? window.localStorage : undefined,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
}: DuelInvitePanelProps) {
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

  useEffect(() => {
    if (!storage || !inviteUrl) return
    let active = true
    const participant = readParticipant(storage, matchId)
    if (participant?.role !== 'A') return
    const refresh = async () => {
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
      }
    }
    const onFocus = () => { void refresh() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [storage, matchId, inviteUrl])

  const onCopy = useCallback(async () => {
    if (!inviteUrl) {
      setFeedback('copy-failed')
      return
    }
    const result = await copyDuelInviteUrl(inviteUrl)
    setFeedback(result === 'copied' ? 'copied' : 'copy-failed')
  }, [inviteUrl])

  const onShare = useCallback(async () => {
    if (!inviteUrl || !shareAvailable) return
    const result = await shareDuelInviteUrl(inviteUrl, t.brandTitle)
    if (result === 'failed') setFeedback('share-failed')
  }, [inviteUrl, shareAvailable, t.brandTitle])

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

  if (playReady) {
    return <DuelPlayScreen matchId={matchId} t={t} />
  }

  if (!inviteUrl) {
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

  return (
    <div className="duel-flow duel-flow--locked duel-flow--invite">
      <div className="duel-status-slot" aria-hidden="true" />
      <p className="duel-locked-label">{t.duelPlacementsLocked}</p>
      <p className="duel-invite-label">{t.duelInviteUrlLabel}</p>
      <p className="duel-invite-url" title={t.duelInviteUrlLabel}>
        {inviteUrl}
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
          <button type="button" className="duel-btn" onClick={onOpenQr}>
            {t.duelInviteQr}
          </button>
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
      {qrOpen && qrSvg ? (
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
