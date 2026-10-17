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
  const [closePending, setClosePending] = useState(false)
  const [resultLoading, setResultLoading] = useState(initialClosed)
  const [fetchedResult, setFetchedResult] = useState<GroupResult | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const resultInFlight = useRef(false)
  const revealInFlight = useRef(false)

  const closed =
    initialClosed || progress?.status === 'closed' || fetchedResult !== null

  const loadResult = useCallback(async () => {
    if (resultInFlight.current || fetchedResult !== null) return
    resultInFlight.current = true
    setResultLoading(true)
    try {
      const result = await coordinator.getResult(groupId)
      if (mounted.current) {
        setError(false)
        setFetchedResult(result)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      resultInFlight.current = false
      if (mounted.current) setResultLoading(false)
    }
  }, [coordinator, fetchedResult, groupId])

  const refresh = useCallback(async () => {
    if (inFlight.current || closed) return
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
  }, [closed, coordinator, groupId])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!closed || fetchedResult !== null || error) return
    const timer = window.setTimeout(() => {
      void loadResult()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [closed, error, fetchedResult, loadResult])

  useEffect(() => {
    if (closed) return
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
  }, [refresh, closed])

  const close = useCallback(async () => {
    if (
      !progress?.hostCloseAvailable ||
      !coordinator.hasHostCapability(groupId) ||
      closePending ||
      closed
    ) {
      return
    }
    if (!window.confirm(t.groupCloseConfirm)) return
    setClosePending(true)
    try {
      const closedProgress = await coordinator.closeGroup(groupId)
      setProgress(closedProgress)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setClosePending(false)
    }
  }, [progress, coordinator, groupId, closePending, closed, t.groupCloseConfirm])

  const retry = useCallback(() => {
    setError(false)
    if (closed) {
      void loadResult()
    } else void refresh()
  }, [closed, loadResult, refresh])

  const revealResult = useCallback(() => {
    if (!fetchedResult || revealInFlight.current) return
    revealInFlight.current = true
    onResult(fetchedResult)
  }, [fetchedResult, onResult])

  const loading = resultLoading || closePending
  const showOpenWaiting = progress?.status === 'open' && !closed
  // Never paint title-only PLAY COMPLETE while progress is still unknown.
  const showPlayCompleteTitle =
    showOpenWaiting ||
    (fetchedResult !== null && !loading) ||
    (error && !loading)
  const showHostClose =
    progress?.hostCloseAvailable === true &&
    coordinator.hasHostCapability(groupId) &&
    !closed
  const awaitingProgress = !loading && progress === null && !error && !closed
  const showViewResult =
    fetchedResult !== null && !loading && !error

  return (
    <div
      className="duel-flow duel-flow--setup group-completion-waiting"
      aria-live="polite"
      aria-busy={awaitingProgress || loading ? true : undefined}
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
        {showOpenWaiting && progress ? (
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
            ? closed
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
              disabled={closePending}
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
      ) : showViewResult ? (
        <div className="duel-btn-area duel-button-field">
          <div className="duel-btn-stack standard-action-stack">
            <button
              type="button"
              className="duel-btn duel-btn--primary"
              onClick={revealResult}
            >
              {t.groupViewResult}
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
