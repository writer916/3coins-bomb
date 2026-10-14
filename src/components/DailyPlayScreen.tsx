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
  type DailyRoundEndReason,
} from '../daily/dailyPlayClient'
import { DAILY_CHALLENGE_ROUNDS } from '../daily/dailyQuestionSet'
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
  | { readonly kind: 'timeout' }

function endReasonOf(terminal: TerminalState): DailyRoundEndReason {
  if (terminal.kind === 'timeout') return 'timed_out'
  if (terminal.kind === 'cash') return 'cashed_out'
  return terminal.result.endReason === 'cleared' ? 'cleared' : 'bombed'
}

export type DailyPlayScreenProps = {
  readonly initialState: DailyPlayState
  readonly coordinator: DailyPlayCoordinator
  readonly t: AppStrings
  readonly onGoTop: () => void
}

export function DailyPlayScreen({
  initialState,
  coordinator,
  t,
  onGoTop,
}: DailyPlayScreenProps) {
  const [play, setPlay] = useState(initialState)
  const [openedResults, setOpenedResults] = useState<readonly DailyOpenResult[]>(
    () =>
      (initialState.activeAttempt?.opens ?? []).map((open) => ({
        challengeDate: initialState.challengeDate,
        roundNumber: initialState.activeAttempt!.roundNumber,
        bagNumber: open.bagNumber,
        openOrder: open.openOrder,
        remainingSecondsAtTap: open.remainingSecondsAtTap,
        outcome: open.outcome,
        coinsFound: open.coinsFound,
        provisionalCoins: 0,
        openedBagCount: open.openOrder,
        roundEnded: false,
        endReason: null,
        capturedCoins: 0,
        elapsedSeconds: null,
        coinBagHits: null,
        participantCompleted: false,
      })),
  )
  const [provisionalCoins, setProvisionalCoins] = useState<0 | 1 | 2 | 3>(() =>
    provisionalCoinsFromOpens(initialState.activeAttempt?.opens ?? []),
  )
  const [terminal, setTerminal] = useState<TerminalState | null>(() => {
    if (initialState.completedAt || initialState.expiredAt) {
      return { kind: 'timeout' }
    }
    return null
  })
  const [remaining, setRemaining] = useState(DAILY_CHALLENGE_ROUNDS > 0 ? 60 : 0)
  const [requestPending, setRequestPending] = useState(false)
  const [retryBag, setRetryBag] = useState<BagId | null>(null)
  const [error, setError] = useState(false)
  const [cashOutError, setCashOutError] = useState(false)
  const [fx, setFx] = useState<ActiveFx | null>(null)
  const [coinFxSample, setCoinFxSample] = useState<CoinFxSample | null>(null)
  const lockRef = useRef(false)
  const gateRef = useRef<OptimisticOpenGate | null>(null)
  const runIdRef = useRef(0)
  const timeoutPollRef = useRef(false)

  const active = play.activeAttempt
  const challengeDate = play.challengeDate
  const completed =
    play.completedAt !== null ||
    (terminal !== null &&
      (terminal.kind === 'cash'
        ? terminal.result.participantCompleted
        : terminal.kind === 'open'
          ? terminal.result.participantCompleted
          : play.completedRounds >= DAILY_CHALLENGE_ROUNDS))

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

  // Countdown from server deadline using a monotonic estimate of server now.
  useEffect(() => {
    if (!active || terminal) {
      setRemaining(0)
      return
    }
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

  // When UI hits 0, poll server for TIME OUT finalize (62s) without inventing score.
  // Do not poll away an in-flight OPEN that was started with remaining > 0.
  useEffect(() => {
    if (
      !active ||
      terminal ||
      remaining > 0 ||
      timeoutPollRef.current ||
      requestPending ||
      fx !== null
    ) {
      return
    }
    timeoutPollRef.current = true
    let cancelled = false
    const poll = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (cancelled) return
        try {
          const next = await coordinator.refresh(challengeDate)
          setPlay(next)
          if (!next.activeAttempt) {
            setTerminal({ kind: 'timeout' })
            setProvisionalCoins(0)
            return
          }
        } catch {
          /* keep polling briefly */
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      }
      timeoutPollRef.current = false
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [active, terminal, remaining, requestPending, fx, coordinator, challengeDate])

  useEffect(() => {
    timeoutPollRef.current = false
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
        setError(true)
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
        setError(true)
        return
      }

      // Freeze R at tap — FX and OPEN share this claim (server remains authoritative).
      const remainingSecondsAtTap = remaining
      unlockCoinAudio()
      warmBagOpenAudio()
      lockRef.current = true
      setRequestPending(true)
      setError(false)
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
        setError(true)
        try {
          const next = await coordinator.refresh(challengeDate)
          setPlay(next)
          if (!next.activeAttempt) {
            setTerminal({ kind: 'timeout' })
            setProvisionalCoins(0)
          }
        } catch {
          /* keep error UI; pending OPEN retained for idempotent retry */
        }
        if (gate.fxDone) unlock()
      }
    },
    [
      active,
      challengeDate,
      coordinator,
      opened,
      openedResults.length,
      provisionalCoins,
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
      setError(true)
      return
    }
    abandonScreenPresentation()
    lockRef.current = true
    setRequestPending(true)
    setCashOutError(false)
    setError(false)
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
      setCashOutError(true)
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
    (terminal.kind === 'timeout'
      ? play.nextRoundNumber !== null
      : (active?.roundNumber ?? play.completedRounds) < DAILY_CHALLENGE_ROUNDS)

  const next = useCallback(async () => {
    if (!canShowNextRound || lockRef.current) return
    lockRef.current = true
    setRequestPending(true)
    setError(false)
    try {
      const nextState = await coordinator.startNext(challengeDate)
      setPlay(nextState)
      setOpenedResults([])
      setProvisionalCoins(0)
      setTerminal(null)
      setRetryBag(null)
    } catch {
      setError(true)
    } finally {
      lockRef.current = false
      setRequestPending(false)
    }
  }, [canShowNextRound, challengeDate, coordinator])

  const soundEnabled = readSoundEnabled()
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

  if (!active && !terminal && play.completedAt) {
    return (
      <div className="duel-play daily-play">
        <p className="duel-instruction" role="status">
          {withDuelNums(t.dailyChallengeComplete)}
        </p>
        <div className="field-action">
          <button type="button" className="dev-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        </div>
      </div>
    )
  }

  if (!active && terminal?.kind === 'timeout' && completed) {
    return (
      <div className="duel-play daily-play">
        <p className="duel-instruction" role="status">
          {withDuelNums(t.dailyChallengeComplete)}
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
          {t.dailyPlayError}
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
    (terminal && terminal.kind !== 'timeout'
      ? terminal.kind === 'cash'
        ? terminal.result.roundNumber
        : terminal.result.roundNumber
      : play.completedRounds)

  const bagCount = (active?.bagCount ?? 3) as BagCount

  return (
    <div className="duel-play daily-play">
      <p className="duel-round-index">
        {t.dailyRoundLabel}{' '}
        <span className="duel-num">{roundNumber}</span>
        {' / '}
        <span className="duel-num">{DAILY_CHALLENGE_ROUNDS}</span>
      </p>
      <p className="daily-play__timer" aria-live="polite">
        <span className="duel-num">{remaining}</span>
      </p>
      {active ? (
        <BagBoard
          bagCount={bagCount}
          hiddenBagIds={hidden}
          onBagTap={(bagId) => {
            void tap(bagId)
          }}
          interactive={!requestPending && !terminal && remaining > 0}
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
        {terminal && completed && fx === null && !requestPending ? (
          <button type="button" className="dev-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        ) : null}
      </div>
      {terminal && fx === null ? (
        <p className="daily-play__end" role="status">
          {endReasonOf(terminal) === 'timed_out'
            ? t.dailyTimeoutLabel
            : endReasonOf(terminal) === 'cashed_out'
              ? t.cashOut
              : endReasonOf(terminal) === 'cleared'
                ? t.dailyClearedLabel
                : t.dailyBombedLabel}
        </p>
      ) : null}
      {completed && fx === null ? (
        <p className="duel-instruction" role="status">
          {withDuelNums(t.dailyChallengeComplete)}
        </p>
      ) : null}
      {error || cashOutError ? (
        <div
          className="duel-play-error stable-message-slot stable-message-slot--play-error"
          role="alert"
        >
          {error ? <p>{t.dailyPlayError}</p> : null}
          {cashOutError ? <p>{t.duelCashOutRetry}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
