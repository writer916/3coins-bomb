import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type { BagId } from '../game/assets'
import { warmBagOpenAudio } from '../game/bagAudio'
import { unlockCoinAudio } from '../game/coinAudio'
import {
  visualHiddenBagIds,
  type CoinFxSample,
  type FxCoinCount,
} from '../game/coinFx'
import { type BagCount } from '../game/formations'
import { abandonScreenPresentation } from '../game/screenPresentation'
import { startOpenPresentation } from '../game/startOpenPresentation'
import { readSoundEnabled } from '../game/sound'
import {
  canShowDailyCashOutButton,
  isDailyCashOutButtonDisabled,
} from '../daily/dailyCashOutUi'
import {
  bagIdToBagNumber,
  bagNumberToBagId,
  provisionalCoinsFromOpens,
  sameDailyLocalAndServerOpen,
  type DailyCashOutResult,
  type DailyLocalOpenResult,
  type DailyOpenResult,
  type DailyPlayCoordinator,
  type DailyPlayState,
  type DailyPlayTerminalAttempt,
} from '../daily/dailyPlayClient'
import { DAILY_CHALLENGE_ROUNDS } from '../daily/dailyQuestionSet'
import {
  canOpenDailyResult,
  canScheduleDailyRecoveryRetry,
  classifyInactivePlaySync,
  dailyRecoveryRetryDelayMs,
  dailyTerminalRemainingSeconds,
  hasInTimePendingAction,
  nextDailyStatusPollDelayMs,
  resolveDailyDisplayEndKind,
  shouldDiscardStalePlaySync,
  type DailyDisplayEndKind,
} from '../daily/dailyRoundEndUi'
import {
  calculateDailyRemainingSeconds,
  estimateDailyServerNowMs,
} from '../daily/dailyTime'
import {
  createOptimisticOpenGate,
  markOptimisticFailed,
  markOptimisticFxDone,
  markOptimisticServerDone,
  type OptimisticOpenGate,
} from '../duel/duelOptimisticOpen'
import { withDuelNums } from '../ui/withDuelNums'
import { BagBoard } from './BagBoard'
import { BombOpenFx } from './BombOpenFx'
import { CoinOpenFx } from './CoinOpenFx'
import { EmptyOpenFx } from './EmptyOpenFx'

type ActiveFx =
  | {
      kind: 'coins'
      bagId: BagId
      count: FxCoinCount
      clearsRound: boolean
      runId: number
      presentationGen: number
    }
  | { kind: 'bomb'; bagId: BagId; runId: number; presentationGen: number }
  | { kind: 'empty'; bagId: BagId; runId: number; presentationGen: number }

type TerminalState =
  | { readonly kind: 'open'; readonly result: DailyOpenResult }
  | { readonly kind: 'cash'; readonly result: DailyCashOutResult }
  | { readonly kind: DailyDisplayEndKind }

function isRoundEndTerminal(terminal: TerminalState): boolean {
  return (
    terminal.kind === 'timeout' ||
    terminal.kind === 'connection_error_end' ||
    terminal.kind === 'challenge_ended'
  )
}

function endLabel(terminal: TerminalState, t: AppStrings): string {
  if (terminal.kind === 'timeout') return t.dailyTimeoutLabel
  if (terminal.kind === 'connection_error_end') return t.dailyConnectionErrorEnd
  if (terminal.kind === 'challenge_ended') return t.dailyChallengeEndedLabel
  if (terminal.kind === 'cash') return t.cashOut
  if (terminal.kind === 'open') {
    return terminal.result.endReason === 'cleared'
      ? t.dailyClearedLabel
      : t.dailyBombedLabel
  }
  return t.dailyTimeoutLabel
}

function terminalRemainingSeconds(terminal: TerminalState): number {
  return dailyTerminalRemainingSeconds(
    terminal.kind === 'open' || terminal.kind === 'cash'
      ? {
          kind: terminal.kind,
          remainingSecondsAtTap: terminal.result.remainingSecondsAtTap,
        }
      : terminal,
  )
}

function opensToResults(
  challengeDate: string,
  roundNumber: number,
  opens: NonNullable<DailyPlayState['activeAttempt']>['opens'],
): DailyOpenResult[] {
  let coins = 0
  return opens.map((open) => {
    coins = open.outcome === 'bomb' ? 0 : Math.min(3, coins + open.coinsFound)
    return {
      challengeDate,
      roundNumber,
      bagNumber: open.bagNumber,
      openOrder: open.openOrder,
      remainingSecondsAtTap: open.remainingSecondsAtTap,
      outcome: open.outcome,
      coinsFound: open.coinsFound,
      provisionalCoins: coins as 0 | 1 | 2 | 3,
      openedBagCount: open.openOrder,
      roundEnded: false,
      endReason: null,
      capturedCoins: 0,
      elapsedSeconds: null,
      coinBagHits: null,
      participantCompleted: false,
    }
  })
}

function restoredTerminal(
  state: DailyPlayState,
): TerminalState | null {
  if (state.activeAttempt) return null
  const attempt = state.latestTerminalAttempt
  if (!attempt) return null
  if (attempt.endReason === 'timed_out') return { kind: 'timeout' }
  if (attempt.endReason === 'cashed_out') {
    return {
      kind: 'cash',
      result: {
        challengeDate: state.challengeDate,
        roundNumber: attempt.roundNumber,
        endReason: 'cashed_out',
        capturedCoins: attempt.capturedCoins as 1 | 2,
        openedBagCount: attempt.openedBagCount,
        elapsedSeconds: attempt.elapsedSeconds,
        coinBagHits: attempt.coinBagHits,
        remainingSecondsAtTap: 60 - attempt.elapsedSeconds,
        participantCompleted: state.completedAt !== null,
      },
    }
  }
  const lastOpen = attempt.opens.at(-1)
  if (!lastOpen) return null
  return {
    kind: 'open',
    result: {
      challengeDate: state.challengeDate,
      roundNumber: attempt.roundNumber,
      bagNumber: lastOpen.bagNumber,
      openOrder: lastOpen.openOrder,
      remainingSecondsAtTap: lastOpen.remainingSecondsAtTap,
      outcome: lastOpen.outcome,
      coinsFound: lastOpen.coinsFound,
      provisionalCoins: attempt.capturedCoins,
      openedBagCount: attempt.openedBagCount,
      roundEnded: true,
      endReason: attempt.endReason,
      capturedCoins: attempt.capturedCoins,
      elapsedSeconds: attempt.elapsedSeconds,
      coinBagHits: attempt.coinBagHits,
      participantCompleted: state.completedAt !== null,
    },
  }
}

function visibleAttempt(state: DailyPlayState):
  | DailyPlayState['activeAttempt']
  | DailyPlayTerminalAttempt
  | null {
  return state.activeAttempt ?? state.latestTerminalAttempt
}

export type DailyPlayScreenProps = {
  readonly initialState: DailyPlayState
  readonly coordinator: DailyPlayCoordinator
  readonly t: AppStrings
  readonly onGoTop: () => void
  /**
   * Invoked only by the explicit RESULT button after server-confirmed completion
   * and ROUND-end FX settle. RESULT／RANKING is shown by the parent.
   */
  readonly onShowResult?: (input: {
    readonly challengeDate: string
  }) => void
}

export function DailyPlayScreen({
  initialState,
  coordinator,
  t,
  onGoTop,
  onShowResult,
}: DailyPlayScreenProps) {
  const [play, setPlay] = useState(initialState)
  const [openedResults, setOpenedResults] = useState<readonly DailyOpenResult[]>(
    () =>
      opensToResults(
        initialState.challengeDate,
        visibleAttempt(initialState)?.roundNumber ?? 1,
        visibleAttempt(initialState)?.opens ?? [],
      ),
  )
  const [provisionalCoins, setProvisionalCoins] = useState<0 | 1 | 2 | 3>(() =>
    initialState.activeAttempt
      ? provisionalCoinsFromOpens(initialState.activeAttempt.opens)
      : (initialState.latestTerminalAttempt?.capturedCoins ?? 0),
  )
  const [terminal, setTerminal] = useState<TerminalState | null>(() => {
    if (initialState.expiredAt) return { kind: 'challenge_ended' }
    const restored = restoredTerminal(initialState)
    if (
      restored?.kind === 'timeout' &&
      (coordinator.getPendingOpen() || coordinator.getPendingCashOut())
    ) {
      return { kind: 'connection_error_end' }
    }
    return restored
  })
  const [remaining, setRemaining] = useState(() =>
    terminal
      ? terminalRemainingSeconds(terminal)
      : initialState.activeAttempt && DAILY_CHALLENGE_ROUNDS > 0
        ? 60
        : 0,
  )
  const [requestPending, setRequestPending] = useState(false)
  const [retryBag, setRetryBag] = useState<BagId | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const [cashOutError, setCashOutError] = useState(false)
  const [fx, setFx] = useState<ActiveFx | null>(null)
  const [coinFxSample, setCoinFxSample] = useState<CoinFxSample | null>(null)
  const lockRef = useRef(false)
  const gateRef = useRef<OptimisticOpenGate | null>(null)
  const runIdRef = useRef(0)
  const statusPollActiveRef = useRef(false)
  const statusPollInFlightRef = useRef(false)
  const wakeStatusPollRef = useRef<(() => void) | null>(null)
  const requestPendingRef = useRef(false)
  const fxRef = useRef<ActiveFx | null>(null)
  const terminalRef = useRef<TerminalState | null>(null)
  const playRef = useRef(play)
  /** Bumped on ROUND advance / unmount-sensitive sync so stale GET play is ignored. */
  const playEpochRef = useRef(0)
  const reconcileInFlightRef = useRef(false)

  useEffect(() => {
    requestPendingRef.current = requestPending
  }, [requestPending])
  useEffect(() => {
    fxRef.current = fx
  }, [fx])
  useEffect(() => {
    terminalRef.current = terminal
  }, [terminal])
  useEffect(() => {
    playRef.current = play
  }, [play])

  // Bootstrap GET has already confirmed this ROUND is terminal. Any restored
  // mutation belongs to that same ROUND (validated by the coordinator), so it
  // can now be discarded without retrying or starting the next ROUND.
  useEffect(() => {
    if (initialState.activeAttempt || !initialState.latestTerminalAttempt) return
    if (coordinator.getPendingOpen()) coordinator.clearPendingOpen()
    if (coordinator.getPendingCashOut()) coordinator.clearPendingCashOut()
  }, [coordinator, initialState.activeAttempt, initialState.latestTerminalAttempt])

  const active = play.activeAttempt
  const challengeDate = play.challengeDate
  const completed =
    play.completedAt !== null ||
    play.expiredAt !== null ||
    (terminal !== null &&
      (terminal.kind === 'cash'
        ? terminal.result.participantCompleted
        : terminal.kind === 'open'
          ? terminal.result.participantCompleted
          : play.completedRounds >= DAILY_CHALLENGE_ROUNDS))
  const resultReady = canOpenDailyResult({
    completedAt: play.completedAt,
    completedRounds: play.completedRounds,
    hasTerminal: terminal !== null,
    terminalParticipantCompleted:
      terminal?.kind === 'cash' || terminal?.kind === 'open'
        ? terminal.result.participantCompleted
        : false,
  })

  const showResult = useCallback(() => {
    if (
      !onShowResult ||
      !resultReady ||
      requestPendingRef.current ||
      fxRef.current !== null ||
      lockRef.current
    ) {
      return
    }
    lockRef.current = true
    try {
      onShowResult({ challengeDate: play.challengeDate })
    } catch {
      lockRef.current = false
    }
  }, [onShowResult, play.challengeDate, resultReady])

  const opened = useMemo(
    () => new Set(openedResults.map((entry) => bagNumberToBagId(entry.bagNumber))),
    [openedResults],
  )
  const hidden = useMemo(() => {
    const visual = new Set(opened)
    if (fx?.kind === 'coins') {
      visual.add(fx.bagId)
      return coinFxSample?.bagId === fx.bagId
        ? visualHiddenBagIds(visual, coinFxSample)
        : opened
    }
    if (fx) visual.add(fx.bagId)
    return visual
  }, [opened, fx, coinFxSample])

  const unlock = useCallback(() => {
    gateRef.current = null
    lockRef.current = false
    setRequestPending(false)
    setFx(null)
    setCoinFxSample(null)
  }, [])

  const fxComplete = useCallback(() => {
    const gate = gateRef.current
    if (!gate || gate.failed || markOptimisticFxDone(gate)) unlock()
  }, [unlock])

  const startFx = useCallback(
    (local: DailyLocalOpenResult, bagId: BagId, coins: number) => {
      const presentationGen = startOpenPresentation(readSoundEnabled())
      const runId = ++runIdRef.current
      if (local.outcome === 'coins') {
        setFx({
          kind: 'coins',
          bagId,
          count: local.coinsFound as FxCoinCount,
          clearsRound: coins + local.coinsFound === 3,
          runId,
          presentationGen,
        })
      } else if (local.outcome === 'bomb') {
        setFx({ kind: 'bomb', bagId, runId, presentationGen })
      } else {
        setFx({ kind: 'empty', bagId, runId, presentationGen })
      }
    },
    [],
  )

  const readInTimePending = useCallback(() => {
    const pendingOpen = coordinator.getPendingOpen()
    const pendingCash = coordinator.getPendingCashOut()
    return hasInTimePendingAction({
      pendingOpenRemainingSeconds: pendingOpen?.remainingSecondsAtTap ?? null,
      pendingCashOutRemainingSeconds:
        pendingCash?.remainingSecondsAtTap ?? null,
    })
  }, [coordinator])

  const applyRoundEndFromState = useCallback(
    (state: DailyPlayState): boolean => {
      const persistedTerminal = restoredTerminal(state)
      const hadPending = readInTimePending()
      const kind = resolveDailyDisplayEndKind({
        state,
        hadInTimePendingAction: hadPending,
      })
      const nextTerminal =
        hadPending && state.latestTerminalAttempt?.endReason === 'timed_out'
          ? { kind: 'connection_error_end' as const }
          : persistedTerminal ?? (kind ? { kind } : null)
      if (!nextTerminal) return false
      if (coordinator.getPendingOpen()) coordinator.clearPendingOpen()
      if (coordinator.getPendingCashOut()) coordinator.clearPendingCashOut()
      setPlay(state)
      setTerminal(nextTerminal)
      const attempt = state.latestTerminalAttempt
      setOpenedResults(
        attempt
          ? opensToResults(state.challengeDate, attempt.roundNumber, attempt.opens)
          : [],
      )
      setProvisionalCoins(attempt?.capturedCoins ?? 0)
      setConnectionError(false)
      setCashOutError(false)
      setRetryBag(null)
      return true
    },
    [coordinator, readInTimePending],
  )

  const syncFromPlayState = useCallback(
    (
      state: DailyPlayState,
    ): 'active' | 'ended' | 'defer_end_for_recovery' | 'unchanged' => {
      const phase = classifyInactivePlaySync({
        hasActiveAttempt: state.activeAttempt !== null,
        hasInTimePendingAction: readInTimePending(),
      })
      if (phase === 'active' && state.activeAttempt) {
        setPlay(state)
        const nextOpens = opensToResults(
          state.challengeDate,
          state.activeAttempt.roundNumber,
          state.activeAttempt.opens,
        )
        setOpenedResults(nextOpens)
        setProvisionalCoins(
          provisionalCoinsFromOpens(state.activeAttempt.opens),
        )
        const pendingOpen = coordinator.getPendingOpen()
        if (
          pendingOpen &&
          state.activeAttempt.opens.some(
            (open) => open.bagNumber === pendingOpen.bagNumber,
          )
        ) {
          coordinator.clearPendingOpen()
          setRetryBag(null)
          setConnectionError(false)
        }
        return 'active'
      }
      // Keep server clocks / counts, but do not invent an end label yet.
      setPlay(state)
      if (phase === 'defer_end_for_recovery') return 'defer_end_for_recovery'
      if (applyRoundEndFromState(state)) return 'ended'
      return 'unchanged'
    },
    [applyRoundEndFromState, coordinator, readInTimePending],
  )

  /**
   * After OPEN/CASH OUT transport failure: refresh, prefer accepted server
   * results via idempotent retry, and only then classify a finalized end label.
   */
  const reconcileAfterMutationFailure = useCallback(
    async (mode: 'open' | 'cash'): Promise<void> => {
      setConnectionError(true)
      reconcileInFlightRef.current = true
      const epochAtStart = playEpochRef.current
      try {
        let state = await coordinator.refresh(challengeDate)
        if (
          shouldDiscardStalePlaySync({
            cancelled: false,
            syncEpoch: epochAtStart,
            currentEpoch: playEpochRef.current,
            hasTerminal: terminalRef.current !== null,
          })
        ) {
          return
        }

        // Do not publish an inactive state before recovering an in-time pending
        // operation. Doing so changes the ROUND epoch mid-reconcile and can
        // discard the confirmed connection-error end result as stale.
        const sync =
          !state.activeAttempt && readInTimePending()
            ? 'defer_end_for_recovery'
            : syncFromPlayState(state)
        if (sync === 'ended') return
        if (sync === 'active') {
          const pendingOpen = coordinator.getPendingOpen()
          if (
            mode === 'open' &&
            pendingOpen &&
            state.activeAttempt &&
            !state.activeAttempt.opens.some(
              (open) => open.bagNumber === pendingOpen.bagNumber,
            )
          ) {
            try {
              const result = await coordinator.open(
                pendingOpen.challengeDate,
                pendingOpen.bagNumber,
                pendingOpen.remainingSecondsAtTap,
              )
              setOpenedResults((current) =>
                current.some((row) => row.bagNumber === result.bagNumber)
                  ? current
                  : [...current, result],
              )
              setProvisionalCoins(result.provisionalCoins)
              setRetryBag(null)
              setConnectionError(false)
              if (result.roundEnded) setTerminal({ kind: 'open', result })
            } catch {
              // Keep the exact persisted command for the next bounded retry.
            }
            return
          }
          if (mode === 'cash' && coordinator.getPendingCashOut()) {
            const pendingCash = coordinator.getPendingCashOut()!
            try {
              const result = await coordinator.cashOut(
                pendingCash.challengeDate,
                pendingCash.remainingSecondsAtTap,
              )
              setTerminal({ kind: 'cash', result })
              setConnectionError(false)
              setCashOutError(false)
            } catch {
              // Keep the exact persisted command for the next bounded retry.
            }
            return
          }
          setConnectionError(false)
          return
        }

        // No active ROUND — restore accepted ops before any end label.
        if (mode === 'open' && coordinator.getPendingOpen()) {
          const pending = coordinator.getPendingOpen()!
          try {
            const result = await coordinator.open(
              pending.challengeDate,
              pending.bagNumber,
              pending.remainingSecondsAtTap,
            )
            if (
              shouldDiscardStalePlaySync({
                cancelled: false,
                syncEpoch: epochAtStart,
                currentEpoch: playEpochRef.current,
                hasTerminal: terminalRef.current !== null,
              })
            ) {
              return
            }
            setOpenedResults((current) => {
              if (current.some((row) => row.bagNumber === result.bagNumber)) {
                return current
              }
              return [...current, result]
            })
            setProvisionalCoins(result.provisionalCoins)
            setRetryBag(null)
            setConnectionError(false)
            if (result.roundEnded) setTerminal({ kind: 'open', result })
            else {
              state = await coordinator.refresh(challengeDate)
              if (
                !shouldDiscardStalePlaySync({
                  cancelled: false,
                  syncEpoch: epochAtStart,
                  currentEpoch: playEpochRef.current,
                  hasTerminal: terminalRef.current !== null,
                })
              ) {
                syncFromPlayState(state)
              }
            }
            return
          } catch {
            // Idempotent restore failed (e.g. 409). Re-read then classify below —
            // never treat 409 alone as TIME OUT without GET play confirmation.
            state = await coordinator.refresh(challengeDate)
            if (
              shouldDiscardStalePlaySync({
                cancelled: false,
                syncEpoch: epochAtStart,
                currentEpoch: playEpochRef.current,
                hasTerminal: terminalRef.current !== null,
              })
            ) {
              return
            }
            if (state.activeAttempt) {
              syncFromPlayState(state)
              return
            }
            applyRoundEndFromState(state)
            return
          }
        }

        if (mode === 'cash' && coordinator.getPendingCashOut()) {
          const pending = coordinator.getPendingCashOut()!
          try {
            const result = await coordinator.cashOut(
              pending.challengeDate,
              pending.remainingSecondsAtTap,
            )
            if (
              shouldDiscardStalePlaySync({
                cancelled: false,
                syncEpoch: epochAtStart,
                currentEpoch: playEpochRef.current,
                hasTerminal: terminalRef.current !== null,
              })
            ) {
              return
            }
            setTerminal({ kind: 'cash', result })
            setRetryBag(null)
            setConnectionError(false)
            setCashOutError(false)
            return
          } catch {
            state = await coordinator.refresh(challengeDate)
            if (
              shouldDiscardStalePlaySync({
                cancelled: false,
                syncEpoch: epochAtStart,
                currentEpoch: playEpochRef.current,
                hasTerminal: terminalRef.current !== null,
              })
            ) {
              return
            }
            if (state.activeAttempt) {
              syncFromPlayState(state)
              setCashOutError(true)
              return
            }
            applyRoundEndFromState(state)
            return
          }
        }

        // Recovery attempted; choose end label only from confirmed inactive play.
        if (
          !state.activeAttempt &&
          !shouldDiscardStalePlaySync({
            cancelled: false,
            syncEpoch: epochAtStart,
            currentEpoch: playEpochRef.current,
            hasTerminal: terminalRef.current !== null,
          })
        ) {
          applyRoundEndFromState(state)
        }
      } catch {
        /* keep connectionError; automatic status poll continues */
      } finally {
        reconcileInFlightRef.current = false
      }
    },
    [
      applyRoundEndFromState,
      challengeDate,
      coordinator,
      readInTimePending,
      syncFromPlayState,
    ],
  )

  // A persisted pending mutation is recovered on mount/reload and whenever
  // connectivity or visibility returns. The reconcile guard serializes all
  // overlapping triggers and the coordinator keeps the original request id/R.
  useEffect(() => {
    const recover = () => {
      if (reconcileInFlightRef.current || terminalRef.current) return
      const mode = coordinator.getPendingOpen()
        ? 'open'
        : coordinator.getPendingCashOut()
          ? 'cash'
          : null
      if (mode) void reconcileAfterMutationFailure(mode)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') recover()
    }
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', onVisible)
    // Deferring avoids React development StrictMode cancelling the first
    // mount effect while its reconcile promise still owns the in-flight guard.
    const mountRecoveryTimer = window.setTimeout(recover, 0)
    return () => {
      window.clearTimeout(mountRecoveryTimer)
      window.removeEventListener('online', recover)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [coordinator, reconcileAfterMutationFailure])

  // A transport failure must recover without waiting for online/visibility.
  // Keep retries finite and serialized; the coordinator reuses the persisted
  // request id and remainingSecondsAtTap for every attempt.
  useEffect(() => {
    if (!connectionError || terminal) return
    if (!coordinator.getPendingOpen() && !coordinator.getPendingCashOut()) return

    let cancelled = false
    let attemptsCompleted = 0
    let retryTimer: number | null = null

    const wait = (delayMs: number) =>
      new Promise<void>((resolve) => {
        retryTimer = window.setTimeout(() => {
          retryTimer = null
          resolve()
        }, delayMs)
      })

    const run = async () => {
      while (
        !cancelled &&
        !terminalRef.current &&
        canScheduleDailyRecoveryRetry(attemptsCompleted)
      ) {
        const mode = coordinator.getPendingOpen()
          ? 'open'
          : coordinator.getPendingCashOut()
            ? 'cash'
            : null
        if (!mode) return

        await wait(dailyRecoveryRetryDelayMs(attemptsCompleted + 1))
        if (cancelled || terminalRef.current) return
        if (reconcileInFlightRef.current) continue

        attemptsCompleted += 1
        await reconcileAfterMutationFailure(mode)
      }
    }

    void run()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [connectionError, coordinator, reconcileAfterMutationFailure, terminal])

  // Countdown from server deadline using a monotonic estimate of server now.
  useEffect(() => {
    if (!active || terminal) return
    const serverNowAtAnchorMs = Date.parse(play.serverNow)
    const monoAtAnchorMs = performance.now()
    const deadlineMs = Date.parse(active.deadlineAt)
    const tick = () => {
      try {
        const nowMs = estimateDailyServerNowMs(
          serverNowAtAnchorMs,
          monoAtAnchorMs,
          performance.now(),
        )
        setRemaining(calculateDailyRemainingSeconds(deadlineMs, nowMs))
      } catch {
        setRemaining(0)
      }
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [active, play.serverNow, terminal])

  // After UI 0: keep confirming server finalize with bounded backoff (no fixed 8-cap).
  useEffect(() => {
    if (
      !active ||
      terminal ||
      remaining > 0 ||
      statusPollActiveRef.current
    ) {
      return
    }
    statusPollActiveRef.current = true
    let cancelled = false
    let delayMs = 500
    let wake: (() => void) | null = null

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          wake = null
          resolve()
        }, ms)
        wake = () => {
          window.clearTimeout(timer)
          wake = null
          resolve()
        }
        wakeStatusPollRef.current = wake
      })

    const epochAtEffectStart = playEpochRef.current

    const pollOnce = async () => {
      if (statusPollInFlightRef.current) return 'busy' as const
      if (reconcileInFlightRef.current) return 'wait' as const
      if (requestPendingRef.current || fxRef.current !== null) {
        return 'wait' as const
      }
      statusPollInFlightRef.current = true
      const syncEpoch = playEpochRef.current
      try {
        const next = await coordinator.refresh(challengeDate)
        if (
          shouldDiscardStalePlaySync({
            cancelled,
            syncEpoch,
            currentEpoch: playEpochRef.current,
            hasTerminal: terminalRef.current !== null,
          })
        ) {
          return 'stale' as const
        }
        // A newer ROUND (NEXT) must never be overwritten by this response.
        if (syncEpoch !== epochAtEffectStart) return 'stale' as const

        const sync = syncFromPlayState(next)
        if (sync === 'ended' || terminalRef.current) return 'ended' as const
        if (sync === 'defer_end_for_recovery') {
          // Pending in-time op: keep polling / wait for reconcile; do not label yet.
          setConnectionError(true)
          const mode = coordinator.getPendingOpen()
            ? 'open'
            : coordinator.getPendingCashOut()
              ? 'cash'
              : null
          if (mode) void reconcileAfterMutationFailure(mode)
          return 'defer' as const
        }
        if (sync === 'active') {
          setConnectionError(false)
          return 'active' as const
        }
        return 'active' as const
      } catch {
        if (cancelled || terminalRef.current) return 'stale' as const
        setConnectionError(true)
        return 'error' as const
      } finally {
        statusPollInFlightRef.current = false
      }
    }

    const run = async () => {
      while (!cancelled && !terminalRef.current) {
        if (
          !playRef.current.activeAttempt &&
          !readInTimePending() &&
          !reconcileInFlightRef.current
        ) {
          break
        }
        const result = await pollOnce()
        if (cancelled || terminalRef.current) break
        if (result === 'ended') break
        if (result === 'error' || result === 'defer') {
          delayMs = nextDailyStatusPollDelayMs(delayMs)
        } else if (result === 'active') {
          delayMs = 500
        }
        await sleep(delayMs)
      }
      statusPollActiveRef.current = false
      wakeStatusPollRef.current = null
    }

    const onOnline = () => {
      delayMs = 500
      setConnectionError(true)
      wakeStatusPollRef.current?.()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        delayMs = 500
        wakeStatusPollRef.current?.()
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    void run()
    return () => {
      cancelled = true
      wakeStatusPollRef.current?.()
      wakeStatusPollRef.current = null
      statusPollActiveRef.current = false
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [
    active,
    terminal,
    remaining,
    coordinator,
    challengeDate,
    syncFromPlayState,
    readInTimePending,
    reconcileAfterMutationFailure,
  ])

  useEffect(() => {
    statusPollActiveRef.current = false
    playEpochRef.current += 1
  }, [active?.roundNumber])

  const tap = useCallback(
    async (bagId: BagId) => {
      if (
        lockRef.current ||
        requestPending ||
        terminal ||
        !active ||
        remaining <= 0 ||
        opened.has(bagId) ||
        (retryBag && retryBag !== bagId)
      ) {
        return
      }
      const bagNumber = bagIdToBagNumber(bagId)
      const pending = coordinator.getPendingOpen()
      if (
        pending &&
        (pending.challengeDate !== challengeDate ||
          pending.bagNumber !== bagNumber)
      ) {
        setConnectionError(true)
        return
      }
      if (coordinator.getPendingCashOut()) {
        setCashOutError(true)
        return
      }

      let local: DailyLocalOpenResult
      try {
        local = coordinator.getLocalOpenResult(
          challengeDate,
          active.roundNumber,
          active.bagCount,
          bagNumber,
        )
      } catch {
        setConnectionError(true)
        return
      }

      // Freeze R at tap — FX and OPEN share this claim (server remains authoritative).
      const remainingSecondsAtTap = remaining
      unlockCoinAudio()
      warmBagOpenAudio()
      lockRef.current = true
      setRequestPending(true)
      setConnectionError(false)
      setCashOutError(false)

      const gate = createOptimisticOpenGate()
      gateRef.current = gate
      // Retry after failed OPEN: FX already shown; wait for server only.
      if (retryBag === bagId) markOptimisticFxDone(gate)
      else startFx(local, bagId, provisionalCoins)

      try {
        const result = await coordinator.open(
          challengeDate,
          bagNumber,
          remainingSecondsAtTap,
        )
        if (
          result.roundNumber !== active.roundNumber ||
          result.openOrder !== openedResults.length + 1 ||
          !sameDailyLocalAndServerOpen(local, result)
        ) {
          throw new Error('mismatch')
        }
        setRetryBag(null)
        setOpenedResults((current) => [...current, result])
        setProvisionalCoins(result.provisionalCoins)
        if (result.roundEnded) setTerminal({ kind: 'open', result })
        if (markOptimisticServerDone(gate)) unlock()
      } catch {
        markOptimisticFailed(gate)
        abandonScreenPresentation()
        setFx(null)
        setCoinFxSample(null)
        setRetryBag(bagId)
        await reconcileAfterMutationFailure('open')
        if (gate.fxDone) unlock()
        else {
          lockRef.current = false
          setRequestPending(false)
        }
      }
    },
    [
      active,
      challengeDate,
      coordinator,
      opened,
      openedResults.length,
      provisionalCoins,
      reconcileAfterMutationFailure,
      remaining,
      requestPending,
      retryBag,
      startFx,
      terminal,
      unlock,
    ],
  )

  const cashOut = useCallback(async () => {
    if (
      lockRef.current ||
      requestPending ||
      fx ||
      terminal ||
      !active ||
      remaining <= 0 ||
      (provisionalCoins !== 1 && provisionalCoins !== 2)
    ) {
      return
    }
    if (coordinator.getPendingOpen()) {
      setConnectionError(true)
      return
    }
    abandonScreenPresentation()
    lockRef.current = true
    setRequestPending(true)
    setCashOutError(false)
    setConnectionError(false)
    try {
      const result = await coordinator.cashOut(challengeDate, remaining)
      if (
        result.roundNumber !== active.roundNumber ||
        result.capturedCoins !== provisionalCoins ||
        result.openedBagCount !== openedResults.length
      ) {
        throw new Error('mismatch')
      }
      setTerminal({ kind: 'cash', result })
      setRetryBag(null)
    } catch {
      await reconcileAfterMutationFailure('cash')
    } finally {
      lockRef.current = false
      setRequestPending(false)
    }
  }, [
    active,
    challengeDate,
    coordinator,
    fx,
    openedResults.length,
    provisionalCoins,
    reconcileAfterMutationFailure,
    remaining,
    requestPending,
    terminal,
  ])

  const canShowNextRound =
    terminal !== null &&
    !requestPending &&
    fx === null &&
    !completed &&
    play.completedRounds < DAILY_CHALLENGE_ROUNDS &&
    (isRoundEndTerminal(terminal)
      ? play.nextRoundNumber !== null
      : (active?.roundNumber ?? play.completedRounds) < DAILY_CHALLENGE_ROUNDS)

  const next = useCallback(async () => {
    if (!canShowNextRound || lockRef.current) return
    lockRef.current = true
    setRequestPending(true)
    setConnectionError(false)
    try {
      const nextState = await coordinator.startNext(challengeDate)
      playEpochRef.current += 1
      setPlay(nextState)
      setOpenedResults([])
      setProvisionalCoins(0)
      setTerminal(null)
      setRetryBag(null)
      setConnectionError(false)
      coordinator.clearPendingOpen()
      coordinator.clearPendingCashOut()
    } catch {
      setConnectionError(true)
    } finally {
      lockRef.current = false
      setRequestPending(false)
    }
  }, [canShowNextRound, challengeDate, coordinator])

  const soundEnabled = readSoundEnabled()
  const displayedRemaining = terminal
    ? terminalRemainingSeconds(terminal)
    : remaining
  const timerExpired = remaining <= 0
  const showCashOut = canShowDailyCashOutButton(
    provisionalCoins,
    terminal !== null,
  )
  const cashOutDisabled = isDailyCashOutButtonDisabled(
    requestPending,
    fx !== null,
    timerExpired,
  )

  if (resultReady && fx === null && !requestPending) {
    return (
      <div
        className="duel-play daily-play daily-play--complete"
        data-daily-play-complete=""
      >
        <p className="duel-instruction" role="status">
          {withDuelNums(t.dailyChallengeComplete)}
        </p>
        <div className="duel-final-actions daily-play__complete-actions">
          {onShowResult ? (
            <button
              type="button"
              className="duel-btn duel-btn--primary"
              data-duel-metric="primary"
              onClick={showResult}
            >
              {t.dailyViewResult}
            </button>
          ) : null}
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top"
            data-duel-metric="secondary"
            onClick={onGoTop}
          >
            {t.duelReturnToTop}
          </button>
        </div>
      </div>
    )
  }

  if (!active && play.expiredAt) {
    return (
      <div className="duel-play daily-play">
        <p className="daily-play__end" role="status">
          {t.dailyChallengeEndedLabel}
        </p>
        <div className="field-action">
          <button type="button" className="dev-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        </div>
      </div>
    )
  }

  if (!active && !terminal) {
    return (
      <div className="duel-play daily-play">
        <p className="duel-play-error" role="alert">
          {connectionError ? t.dailyConnectionError : t.dailyPlayError}
        </p>
        <div className="field-action">
          <button type="button" className="dev-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        </div>
      </div>
    )
  }

  const roundNumber =
    active?.roundNumber ??
    (terminal?.kind === 'cash' || terminal?.kind === 'open'
      ? terminal.result.roundNumber
      : play.completedRounds)

  const displayAttempt = visibleAttempt(play)
  const bagCount = (displayAttempt?.bagCount ?? 3) as BagCount

  return (
    <div className="duel-play daily-play">
      <p className="duel-round-index">
        {t.dailyRoundLabel}{' '}
        <span className="duel-num">{roundNumber}</span>
        {' / '}
        <span className="duel-num">{DAILY_CHALLENGE_ROUNDS}</span>
      </p>
      <p className="daily-play__timer" aria-live="polite">
        <span className="duel-num">{displayedRemaining}</span>
      </p>
      {displayAttempt ? (
        <BagBoard
          bagCount={bagCount}
          hiddenBagIds={hidden}
          onBagTap={(bagId) => {
            void tap(bagId)
          }}
          interactive={
            active !== null && !requestPending && !terminal && remaining > 0
          }
        >
          {fx?.kind === 'coins' ? (
            <CoinOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={bagCount}
              coinCount={fx.count}
              clearsRound={fx.clearsRound}
              soundEnabled={soundEnabled}
              presentationGen={fx.presentationGen}
              onSample={setCoinFxSample}
              onVisualComplete={fx.clearsRound ? undefined : fxComplete}
              onComplete={fxComplete}
            />
          ) : null}
          {fx?.kind === 'empty' ? (
            <EmptyOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={bagCount}
              presentationGen={fx.presentationGen}
              onVisualComplete={fxComplete}
              onComplete={fxComplete}
            />
          ) : null}
          {fx?.kind === 'bomb' ? (
            <BombOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={bagCount}
              hiddenBagIds={hidden}
              soundEnabled={soundEnabled}
              presentationGen={fx.presentationGen}
              onComplete={fxComplete}
            />
          ) : null}
        </BagBoard>
      ) : null}
      <div className="field-action" aria-live="polite">
        {showCashOut ? (
          <button
            type="button"
            className="dev-btn cash-out-btn"
            disabled={cashOutDisabled}
            onClick={() => {
              void cashOut()
            }}
          >
            {t.cashOut}
          </button>
        ) : null}
        {canShowNextRound ? (
          <button
            type="button"
            className="dev-btn end-action-btn standard-round-action-btn standard-round-action-btn--next-round"
            onClick={() => {
              void next()
            }}
          >
            {t.nextRound}
          </button>
        ) : null}
      </div>
      <p
        className="daily-play__end daily-play__end-slot"
        role={terminal && fx === null ? 'status' : undefined}
        aria-hidden={terminal && fx === null ? undefined : true}
      >
        {terminal && fx === null ? endLabel(terminal, t) : '\u00a0'}
      </p>
      {connectionError || cashOutError ? (
        <div
          className="duel-play-error stable-message-slot stable-message-slot--play-error"
          role="alert"
        >
          {connectionError && !terminal ? (
            <p>{t.dailyConnectionError}</p>
          ) : null}
          {cashOutError && !terminal ? <p>{t.duelCashOutRetry}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
