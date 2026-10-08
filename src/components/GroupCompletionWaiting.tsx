import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type {
  GroupProgress,
  GroupResult,
  createGroupPlayBootstrapCoordinator,
} from '../group/groupPlayClient'

type Coordinator = ReturnType<typeof createGroupPlayBootstrapCoordinator>
const POLL_MS = 5000

function ProgressCount({
  current,
  limit,
  ariaLabel,
}: {
  readonly current: number
  readonly limit: number
  readonly ariaLabel: string
}) {
  return (
    <span className="group-completion-waiting__count" aria-label={ariaLabel}>
      <span className="duel-num">{current}</span>
      <span className="group-completion-waiting__slash" aria-hidden="true">
        {' / '}
      </span>
      <span className="duel-num">{limit}</span>
    </span>
  )
}

export function GroupCompletionWaiting({
  groupId,
  coordinator,
  t,
  onResult,
  initialClosed = false,
  initialProgress = null,
}: {
  groupId: string
  coordinator: Coordinator
  t: AppStrings
  onResult: (result: GroupResult) => void
  initialClosed?: boolean
  initialProgress?: GroupProgress | null
}) {
  const [progress, setProgress] = useState<GroupProgress | null>(initialProgress)
  const [error, setError] = useState(false)
  const [resultPending, setResultPending] = useState(initialClosed)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const resultInFlight = useRef(false)

  const loadResult = useCallback(async () => {
    if (resultInFlight.current) return
    resultInFlight.current = true
    try {
      const result = await coordinator.getResult(groupId)
      if (mounted.current) {
        setError(false)
        onResult(result)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      resultInFlight.current = false
      if (mounted.current) setResultPending(false)
    }
  }, [coordinator, groupId, onResult])

  const refresh = useCallback(async () => {
    if (inFlight.current || initialClosed) return
    inFlight.current = true
    try {
      const next = await coordinator.getProgress(groupId)
      if (mounted.current) {
        setProgress(next)
        setError(false)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      inFlight.current = false
    }
  }, [coordinator, groupId, initialClosed])

  useEffect(() => {
    mounted.current = true
    const timer = initialClosed
      ? window.setTimeout(() => {
          void loadResult()
        }, 0)
      : null
    return () => {
      mounted.current = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [initialClosed, loadResult])

  useEffect(() => {
    if (progress?.status !== 'closed') return
    const timer = window.setTimeout(() => {
      void loadResult()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [progress?.status, loadResult])

  useEffect(() => {
    if (initialClosed || progress?.status === 'closed') return
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh, progress?.status, initialClosed])

  const close = useCallback(async () => {
    if (
      !progress?.hostCloseAvailable ||
      !coordinator.hasHostCapability(groupId) ||
      resultPending
    ) {
      return
    }
    if (!window.confirm(t.groupCloseConfirm)) return
    setResultPending(true)
    try {
      const closed = await coordinator.closeGroup(groupId)
      setProgress(closed)
      setError(false)
    } catch {
      setError(true)
      setResultPending(false)
    }
  }, [progress, coordinator, groupId, resultPending, t.groupCloseConfirm])

  const retry = useCallback(() => {
    setError(false)
    if (initialClosed || progress?.status === 'closed') {
      setResultPending(true)
      void loadResult()
    } else void refresh()
  }, [initialClosed, progress?.status, loadResult, refresh])

  const loading =
    initialClosed || progress?.status === 'closed' || resultPending
  const showOpenWaiting = progress?.status === 'open'
  // Never paint title-only PLAY COMPLETE while progress is still unknown.
  const showPlayCompleteTitle = showOpenWaiting || (error && !loading)
  const showHostClose =
    progress?.hostCloseAvailable === true &&
    coordinator.hasHostCapability(groupId)
  const awaitingProgress = !loading && progress === null && !error

  return (
    <div
      className="duel-flow duel-flow--setup group-completion-waiting"
      aria-live="polite"
      aria-busy={awaitingProgress ? true : undefined}
    >
      <div className="duel-status-slot" aria-hidden="true" />
      <div className="duel-setup-spacer duel-setup-spacer--top" aria-hidden="true" />
      <div className="duel-setup-hero">
        <p className="duel-instruction">
          {loading
            ? t.groupResultLoading
            : showPlayCompleteTitle
              ? t.groupPlayComplete
              : '\u00a0'}
        </p>
        {progress?.status === 'open' ? (
          <div className="group-completion-waiting__stats">
            <span className="group-completion-waiting__label">
              {t.groupReadyPlayersLabel}
            </span>
            <ProgressCount
              current={progress.acceptedCount}
              limit={progress.playerLimit}
              ariaLabel={t.groupParticipantsProgress(
                progress.acceptedCount,
                progress.playerLimit,
              )}
            />
            <span className="group-completion-waiting__label">
              {t.groupCompletedLabel}
            </span>
            <ProgressCount
              current={progress.completedCount}
              limit={progress.playerLimit}
              ariaLabel={t.groupCompletedProgress(
                progress.completedCount,
                progress.playerLimit,
              )}
            />
          </div>
        ) : null}
        <p
          className="duel-lock-error stable-message-slot stable-message-slot--waiting-error"
          role={error ? 'alert' : undefined}
          aria-hidden={error ? undefined : 'true'}
        >
          {error
            ? initialClosed || progress?.status === 'closed'
              ? t.groupResultError
              : t.groupProgressError
            : '\u00a0'}
        </p>
        {/*
          Host close is an exception — keep it under the waiting copy,
          not as the setup shell’s primary CTA.
        */}
        {showHostClose ? (
          <div className="group-completion-waiting__aux">
            <button
              type="button"
              className="duel-btn duel-btn--quiet-top group-completion-waiting__close"
              disabled={resultPending}
              onClick={() => {
                void close()
              }}
            >
              {t.groupClose}
            </button>
          </div>
        ) : null}
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
      {error ? (
        <div className="duel-btn-area duel-button-field">
          <div className="duel-btn-stack standard-action-stack">
            <button type="button" className="duel-btn" onClick={retry}>
              {t.groupResultRetry}
            </button>
          </div>
        </div>
      ) : (
        <div className="duel-btn-area duel-button-field" aria-hidden="true" />
      )}
      <div className="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true" />
    </div>
  )
}
