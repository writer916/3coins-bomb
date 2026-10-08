import { useCallback, useState } from 'react'
import type { AppStrings } from '../i18n'
import {
  copyGroupInviteUrl,
  formatGroupShareUrlForDisplay,
  GroupInviteActionError,
  renderGroupHostQrSvg,
  renderGroupInviteQrSvg,
  shareGroupInviteUrl,
} from '../group/groupInviteActions'

type Feedback = 'idle' | 'copied' | 'copy-failed' | 'share-failed'
type SharePage = 'players' | 'host'

function InviteCopyIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg className="duel-invite-copy-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9.55 17.3 4.8 12.55l1.4-1.4 3.35 3.35 8.25-8.25 1.4 1.4z"
        />
      </svg>
    )
  }
  return (
    <svg className="duel-invite-copy-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3h9a2 2 0 0 1 2 2v11h-2V5H9V3zm-4 4h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h9V9H5z"
      />
    </svg>
  )
}

/**
 * DUEL invite wizard pattern (opponent → self), adapted for GROUP.
 * Page 1: player invite URL (`#invite=`). Page 2: host personal URL (`#host=`).
 */
export function GroupInviteShareScreen({
  invitationUrl,
  hostUrl,
  t,
  onEnterNickname,
}: {
  readonly invitationUrl: string
  readonly hostUrl: string
  readonly t: AppStrings
  readonly onEnterNickname: () => void
}) {
  const [page, setPage] = useState<SharePage>('players')
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const activeUrl = page === 'players' ? invitationUrl : hostUrl
  const displayUrl = formatGroupShareUrlForDisplay(activeUrl)

  const onCopy = useCallback(async () => {
    try {
      const result = await copyGroupInviteUrl(activeUrl)
      setFeedback(result === 'copied' ? 'copied' : 'copy-failed')
    } catch {
      setFeedback('copy-failed')
    }
  }, [activeUrl])

  const onShare = useCallback(async () => {
    try {
      const result = await shareGroupInviteUrl(activeUrl, t.brandTitle)
      if (result === 'shared' || result === 'cancelled') return
      const copied = await copyGroupInviteUrl(activeUrl)
      setFeedback(copied === 'copied' ? 'copied' : 'share-failed')
    } catch {
      setFeedback('share-failed')
    }
  }, [activeUrl, t.brandTitle])

  const onOpenQr = useCallback(() => {
    try {
      setQrSvg(
        page === 'players'
          ? renderGroupInviteQrSvg(invitationUrl)
          : renderGroupHostQrSvg(hostUrl),
      )
      setQrOpen(true)
      setFeedback('idle')
    } catch (error: unknown) {
      if (!(error instanceof GroupInviteActionError)) {
        /* swallow */
      }
      setFeedback('copy-failed')
    }
  }, [hostUrl, invitationUrl, page])

  const feedbackText =
    feedback === 'copied'
      ? t.duelInviteCopied
      : feedback === 'copy-failed'
        ? t.duelInviteCopyFailed
        : feedback === 'share-failed'
          ? t.duelInviteShareFailed
          : null

  const label =
    page === 'players' ? t.groupInvitePlayersLabel : t.groupInviteHostLabel

  return (
    <div className="duel-flow duel-flow--locked duel-flow--invite group-invite-share">
      <div className="duel-invite-page">
        <h2 className="duel-invite-label">{label}</h2>
        <div className="group-invite-copy-block">
          <p className="duel-invite-note">
            {page === 'players' ? t.groupInvitePlayersIntro : t.groupInviteHostIntro}
          </p>
          {page === 'host' ? (
            <p className="duel-invite-note group-invite-host-private">
              {t.groupInviteHostKeepPrivate}
            </p>
          ) : null}
        </div>
        <div className="duel-invite-url-bar">
          <p className="duel-invite-url-text" title={activeUrl}>
            {displayUrl}
          </p>
          <button
            type="button"
            className={
              feedback === 'copied'
                ? 'duel-invite-copy duel-invite-copy--done'
                : 'duel-invite-copy'
            }
            aria-label={t.duelInviteCopyAria}
            title={t.duelInviteCopy}
            onClick={() => {
              void onCopy()
            }}
          >
            <InviteCopyIcon done={feedback === 'copied'} />
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
          <button type="button" className="duel-btn" onClick={onOpenQr}>
            {t.duelInviteQr}
          </button>
        </div>
        <p
          className="duel-invite-feedback"
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
          onClick={() => {
            if (page === 'players') {
              setPage('host')
              setQrOpen(false)
              setQrSvg(null)
              setFeedback('idle')
              return
            }
            onEnterNickname()
          }}
        >
          {page === 'players' ? t.duelInviteNext : t.groupInviteEnterNickname}
        </button>
      </div>
      {qrOpen && qrSvg ? (
        <div className="duel-invite-qr-overlay" role="dialog" aria-modal="true">
          <div className="duel-invite-qr-panel">
            <div
              className="duel-invite-qr-svg"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <button
              type="button"
              className="duel-btn"
              onClick={() => {
                setQrOpen(false)
                setQrSvg(null)
              }}
            >
              {t.duelInviteQrClose}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
