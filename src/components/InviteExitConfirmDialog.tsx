import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'

export function InviteExitConfirmDialog({
  t,
  onCancel,
  onConfirm,
}: {
  readonly t: AppStrings
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const confirmStartedRef = useRef(false)
  const [confirming, setConfirming] = useState(false)

  const cancel = useCallback(() => {
    if (confirmStartedRef.current) return
    onCancel()
  }, [onCancel])

  const confirm = useCallback(() => {
    if (confirmStartedRef.current) return
    confirmStartedRef.current = true
    setConfirming(true)
    onConfirm()
  }, [onConfirm])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancel])

  return (
    <div
      className="invite-exit-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-exit-confirm-title"
      aria-describedby="invite-exit-confirm-description"
    >
      <div className="invite-exit-confirm-panel">
        <h2 id="invite-exit-confirm-title" className="invite-exit-confirm-title">
          {t.inviteExitConfirmTitle}
        </h2>
        <p
          id="invite-exit-confirm-description"
          className="invite-exit-confirm-description"
        >
          {t.inviteExitConfirmDescription}
        </p>
        <div className="invite-exit-confirm-actions">
          <button
            type="button"
            className="duel-btn"
            onClick={cancel}
            disabled={confirming}
            autoFocus
          >
            {t.inviteExitConfirmCancel}
          </button>
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            onClick={confirm}
            disabled={confirming}
          >
            {t.inviteExitConfirmAction}
          </button>
        </div>
      </div>
    </div>
  )
}
