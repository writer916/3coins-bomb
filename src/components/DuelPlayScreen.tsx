import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type { BagId } from '../game/assets'
import { playBagOpen, warmBagOpenAudio } from '../game/bagAudio'
import { resolveBagOpenSeRequest } from '../game/bagSfx'
import { unlockCoinAudio } from '../game/coinAudio'
import type { FxCoinCount } from '../game/coinFx'
import type { BagCount } from '../game/formations'
import { canRequestReveal, canShowEndActions, type RevealPlan } from '../game/reveal'
import type { RoundPhase } from '../game/round'
import { readSoundEnabled } from '../game/sound'
import {
  bagIdToBagNumber,
  bagNumberToBagId,
  createDuelPlayClient,
  type DuelActiveRound,
  type DuelCashOutResult,
  type DuelOpenResult,
  type DuelPlayEndReason,
  type DuelPlayState,
  type DuelFinalResult,
} from '../duel/duelPlayClient'
import {
  buildDuelRevealPlan,
  canAdvanceDuelPlay,
  canOfferDuelCashOut,
  createDuelPlayCoordinator,
  selectDuelDisplayedRound,
  type DuelDisplayedRound,
} from '../duel/duelPlayCoordinator'
import { BagBoard } from './BagBoard'
import { BombOpenFx } from './BombOpenFx'
import { CoinOpenFx } from './CoinOpenFx'
import { EmptyOpenFx } from './EmptyOpenFx'
import { RevealBoard } from './RevealBoard'
import { DuelResultScreen } from './DuelResultScreen'

type DuelPlayScreenProps = {
  readonly matchId: string
  readonly t: AppStrings
}

type ReadyView = {
  readonly phase: 'ready'
  readonly totalRounds: number
  readonly round: DuelDisplayedRound
  /** GET /play still has activeRound — no next step when final ROUND completed. */
  readonly canAdvance: boolean
  readonly selfProgress: DuelPlayState['selfProgress']
}

type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | ReadyView

type ActiveFx =
  | { readonly kind: 'coins'; readonly bagId: BagId; readonly count: FxCoinCount; readonly clearsRound: boolean; readonly runId: number }
  | { readonly kind: 'bomb'; readonly bagId: BagId; readonly runId: number }
  | { readonly kind: 'empty'; readonly bagId: BagId; readonly runId: number }

const ignoreCoinFxSample = () => {}

function duelTerminalPhase(endReason: DuelPlayEndReason): RoundPhase {
  if (endReason === 'bombed') return 'bombed'
  if (endReason === 'cleared') return 'cleared'
  return 'cashed-out'
}

function readyView(state: DuelPlayState): ReadyView | null {
  const round = selectDuelDisplayedRound(state)
  return round
    ? {
        phase: 'ready',
        totalRounds: state.totalRounds,
        round,
        canAdvance: canAdvanceDuelPlay(state),
        selfProgress: state.selfProgress,
      }
    : null
}

function openedBagIds(round: DuelDisplayedRound): ReadonlySet<BagId> {
  return new Set(round.openedBags.map((entry) => bagNumberToBagId(entry.bagNumber)))
}

function allBagIdsForCount(bagCount: number): ReadonlySet<BagId> {
  const ids = new Set<BagId>()
  for (let n = 1; n <= bagCount; n += 1) ids.add(bagNumberToBagId(n))
  return ids
}

function appendOpen(round: DuelActiveRound, result: DuelOpenResult): DuelDisplayedRound {
  const openedBags = [...round.openedBags, {
    bagNumber: result.bagNumber,
    openOrder: result.openOrder,
    outcome: result.outcome,
    coinsFound: result.coinsFound,
  }]
  if (result.roundEnded) {
    return {
      terminal: true,
      roundNumber: result.roundNumber,
      bagCount: round.bagCount,
      openedBags,
      endReason: result.endReason!,
      capturedCoins: result.capturedCoins!,
      openedBagCount: result.openedBagCount,
    }
  }
  return {
    terminal: false,
    roundNumber: result.roundNumber,
    bagCount: round.bagCount,
    openedBags,
    provisionalCoins: result.provisionalCoins as 0 | 1 | 2,
    nextOpenOrder: result.openOrder + 1,
  }
}

function applyCashOut(round: DuelActiveRound, result: DuelCashOutResult): DuelDisplayedRound {
  return {
    terminal: true,
    roundNumber: result.roundNumber,
    bagCount: round.bagCount,
    openedBags: round.openedBags,
    endReason: result.endReason,
    capturedCoins: result.capturedCoins,
    openedBagCount: result.openedBagCount,
  }
}

export function DuelPlayScreen({ matchId, t }: DuelPlayScreenProps) {
  const [coordinator] = useState(() => typeof window === 'undefined' ? null :
    createDuelPlayCoordinator(createDuelPlayClient({
      storage: window.localStorage,
      fetch: window.fetch.bind(window),
      crypto: window.crypto,
    })))
  const [view, setView] = useState<ViewState>({ phase: 'loading' })
  const [requestPending, setRequestPending] = useState(false)
  const [retryBag, setRetryBag] = useState<BagId | null>(null)
  const [fx, setFx] = useState<ActiveFx | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [revealPlan, setRevealPlan] = useState<RevealPlan | null>(null)
  const [revealPending, setRevealPending] = useState(false)
  const [finalResult, setFinalResult] = useState<DuelFinalResult | null>(null)
  const [resultPending, setResultPending] = useState(false)
  const [resultError, setResultError] = useState(false)
  const runIdRef = useRef(0)
  const interactionLockedRef = useRef(false)
  const resultPendingRef = useRef(false)
  const revealedRef = useRef(false)
  const viewRef = useRef(view)

  useEffect(() => {
    revealedRef.current = revealed
  }, [revealed])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    let active = true
    if (!coordinator) return
    void coordinator.load(matchId).then((state) => {
      if (!active) return
      const ready = readyView(state)
      setRevealed(false)
      setRevealPlan(null)
      setView(ready ?? { phase: 'error' })
    }).catch(() => {
      if (active) setView({ phase: 'error' })
    })
    return () => { active = false }
  }, [coordinator, matchId])

  const opened = useMemo(
    () => view.phase === 'ready' ? openedBagIds(view.round) : new Set<BagId>(),
    [view],
  )
  const hiddenBagIds = useMemo(() => {
    if (view.phase !== 'ready') return opened
    if (revealed) return allBagIdsForCount(view.round.bagCount)
    return opened
  }, [view, opened, revealed])

  const clearFx = useCallback(() => {
    interactionLockedRef.current = false
    setFx(null)
  }, [])

  const refreshSelfProgress = useCallback(() => {
    if (!coordinator) return
    void coordinator.load(matchId).then((state) => {
      setView((current) => current.phase === 'ready'
        ? { ...current, selfProgress: state.selfProgress }
        : current)
    }).catch(() => {
      // The terminal action is persisted; a later reload can recover progress.
    })
  }, [coordinator, matchId])

  const handleBagTap = useCallback(async (bagId: BagId) => {
    if (
      interactionLockedRef.current || view.phase !== 'ready' ||
      view.round.terminal || requestPending || fx || revealed
    ) return
    if (opened.has(bagId) || (retryBag && retryBag !== bagId)) return
    if (!coordinator) return

    unlockCoinAudio()
    warmBagOpenAudio()
    interactionLockedRef.current = true
    setRequestPending(true)
    try {
      const outcome = await coordinator.open({
        matchId,
        roundNumber: view.round.roundNumber,
        bagNumber: bagIdToBagNumber(bagId),
        expectedOpenOrder: view.round.nextOpenOrder,
      })
      setRetryBag(null)
      if (outcome.kind === 'resynced') {
        interactionLockedRef.current = false
        setRevealed(false)
        setRevealPlan(null)
        const ready = readyView(outcome.state)
        setView(ready ?? { phase: 'error' })
        return
      }

      const result = outcome.result
      const nextRound = appendOpen(view.round, result)
      setView({
        phase: 'ready',
        totalRounds: view.totalRounds,
        round: nextRound,
        canAdvance: nextRound.terminal ? !result.participantCompleted : false,
        selfProgress: view.selfProgress,
      })
      const soundEnabled = readSoundEnabled()
      if (resolveBagOpenSeRequest(soundEnabled, true).play) {
        playBagOpen({ soundEnabled: true })
      }
      runIdRef.current += 1
      if (result.outcome === 'coins') {
        setFx({
          kind: 'coins', bagId, count: result.coinsFound as FxCoinCount,
          clearsRound: result.roundEnded && result.endReason === 'cleared',
          runId: runIdRef.current,
        })
      } else if (result.outcome === 'bomb') {
        setFx({ kind: 'bomb', bagId, runId: runIdRef.current })
      } else {
        setFx({ kind: 'empty', bagId, runId: runIdRef.current })
      }
      if (result.roundEnded) refreshSelfProgress()
    } catch {
      interactionLockedRef.current = false
      setRetryBag(bagId)
    } finally {
      setRequestPending(false)
    }
  }, [view, requestPending, fx, opened, retryBag, matchId, coordinator, revealed, refreshSelfProgress])

  const handleCashOut = useCallback(async () => {
    if (
      interactionLockedRef.current || view.phase !== 'ready' ||
      view.round.terminal || requestPending || fx || revealed
    ) return
    if (!canOfferDuelCashOut(view.round) || !coordinator) return

    interactionLockedRef.current = true
    setRequestPending(true)
    try {
      const outcome = await coordinator.cashOut({
        matchId,
        roundNumber: view.round.roundNumber,
      })
      setRetryBag(null)
      if (outcome.kind === 'resynced') {
        interactionLockedRef.current = false
        setRevealed(false)
        setRevealPlan(null)
        const ready = readyView(outcome.state)
        setView(ready ?? { phase: 'error' })
        return
      }

      const result = outcome.result
      setView({
        phase: 'ready',
        totalRounds: view.totalRounds,
        round: applyCashOut(view.round, result),
        canAdvance: !result.participantCompleted,
        selfProgress: view.selfProgress,
      })
      refreshSelfProgress()
      interactionLockedRef.current = false
    } catch {
      interactionLockedRef.current = false
      setRetryBag(null)
    } finally {
      setRequestPending(false)
    }
  }, [view, requestPending, fx, revealed, matchId, coordinator, refreshSelfProgress])

  const handleReveal = useCallback(async () => {
    const current = viewRef.current
    if (!coordinator || current.phase !== 'ready' || !current.round.terminal) return
    if (revealPending || fx !== null) return
    if (!canRequestReveal(
      duelTerminalPhase(current.round.endReason),
      false,
      revealedRef.current,
    )) return

    setRevealPending(true)
    try {
      const reveal = await coordinator.getRoundReveal(matchId, current.round.roundNumber)
      const plan = buildDuelRevealPlan(
        reveal,
        current.round.openedBags.map((entry) => entry.bagNumber),
      )
      setRevealPlan(plan)
      setRevealed(true)
    } catch {
      setRetryBag(null)
    } finally {
      setRevealPending(false)
    }
  }, [coordinator, matchId, fx, revealPending])

  const handleNextRound = useCallback(async () => {
    const current = viewRef.current
    if (!coordinator || current.phase !== 'ready' || !current.round.terminal) return
    if (!current.canAdvance || requestPending || fx !== null || revealPending) return

    setRequestPending(true)
    try {
      const state = await coordinator.load(matchId)
      if (!state.activeRound) {
        setView({
          phase: 'ready',
          totalRounds: state.totalRounds,
          round: current.round,
          canAdvance: false,
          selfProgress: state.selfProgress,
        })
        return
      }
      setRevealed(false)
      setRevealPlan(null)
      setRetryBag(null)
      setView({
        phase: 'ready',
        totalRounds: state.totalRounds,
        round: { ...state.activeRound, terminal: false },
        canAdvance: false,
        selfProgress: state.selfProgress,
      })
    } catch {
      /* keep terminal view; user can retry NEXT ROUND */
    } finally {
      setRequestPending(false)
    }
  }, [coordinator, matchId, requestPending, fx, revealPending])

  const handleResult = useCallback(async () => {
    if (!coordinator || resultPendingRef.current) return
    const current = viewRef.current
    if (
      current.phase !== 'ready' || !current.round.terminal ||
      current.round.roundNumber !== current.totalRounds
    ) return
    resultPendingRef.current = true
    setResultPending(true)
    setResultError(false)
    try {
      setFinalResult(await coordinator.getFinalResult(matchId))
    } catch {
      setResultError(true)
    } finally {
      resultPendingRef.current = false
      setResultPending(false)
    }
  }, [coordinator, matchId])

  if (view.phase === 'loading') {
    return <div className="duel-play-status" role="status">{t.duelPlayLoading}</div>
  }
  if (view.phase === 'error') {
    return <div className="duel-play-status" role="alert">{t.duelPlayError}</div>
  }

  if (finalResult) {
    return (
      <DuelResultScreen
        result={finalResult}
        pending={resultPending}
        error={resultError}
        onCheck={() => { void handleResult() }}
        t={t}
      />
    )
  }

  const { round, canAdvance } = view
  const soundEnabled = readSoundEnabled()
  const openFxActive = fx !== null
  const terminalPhase = round.terminal ? duelTerminalPhase(round.endReason) : 'active'
  const showEndActions =
    round.terminal && canShowEndActions(terminalPhase, openFxActive || revealPending)
  const showCashOut =
    canOfferDuelCashOut(round) && !showEndActions && !requestPending && !openFxActive && !revealed
  const showRevealBtn =
    showEndActions &&
    canRequestReveal(terminalPhase, openFxActive || revealPending, revealed)
  const showNextRound = showEndActions && canAdvance
  const showResult = showEndActions && !canAdvance && round.roundNumber === view.totalRounds
  const canTap = !round.terminal && !requestPending && !fx && !revealed

  return (
    <div className="duel-play">
      <p className="duel-round-index">{t.duelRoundProgress(round.roundNumber, view.totalRounds)}</p>
      <div className="duel-play-board">
        <BagBoard
          bagCount={round.bagCount as BagCount}
          hiddenBagIds={hiddenBagIds}
          onBagTap={canTap ? handleBagTap : undefined}
        >
          {revealPlan ? <RevealBoard plan={revealPlan} /> : null}
          {fx?.kind === 'coins' ? (
            <CoinOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={round.bagCount as BagCount}
              coinCount={fx.count}
              clearsRound={fx.clearsRound}
              soundEnabled={soundEnabled}
              onSample={ignoreCoinFxSample}
              onComplete={clearFx}
            />
          ) : null}
          {fx?.kind === 'bomb' ? (
            <BombOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={round.bagCount as BagCount}
              hiddenBagIds={hiddenBagIds}
              soundEnabled={soundEnabled}
              onComplete={clearFx}
            />
          ) : null}
          {fx?.kind === 'empty' ? (
            <EmptyOpenFx
              key={fx.runId}
              bagId={fx.bagId}
              bagCount={round.bagCount as BagCount}
              onComplete={clearFx}
            />
          ) : null}
        </BagBoard>
      </div>
      <div className="field-action" aria-live="polite">
        {showCashOut ? (
          <button
            type="button"
            className="dev-btn cash-out-btn"
            onClick={() => { void handleCashOut() }}
            disabled={requestPending}
          >
            {t.cashOut}
          </button>
        ) : null}
        {showEndActions ? (
          <div className="end-actions">
            <div className="end-action-slot">
              {showRevealBtn ? (
                <button
                  type="button"
                  className="dev-btn end-action-btn"
                  onClick={() => { void handleReveal() }}
                  disabled={revealPending}
                >
                  {t.reveal}
                </button>
              ) : null}
            </div>
            <div className="end-action-slot">
              {showNextRound ? (
                <button
                  type="button"
                  className="dev-btn end-action-btn"
                  onClick={() => { void handleNextRound() }}
                  disabled={requestPending}
                >
                  {t.nextRound}
                </button>
              ) : showResult ? (
                <button
                  type="button"
                  className="dev-btn end-action-btn"
                  onClick={() => { void handleResult() }}
                  disabled={resultPending}
                >
                  {t.duelResult}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {retryBag ? <p className="duel-play-error" role="alert">{t.duelOpenRetry}</p> : null}
      {resultError ? <p className="duel-play-error" role="alert">{t.duelResultError}</p> : null}
      <div className="group-session" aria-live="polite">
        <div className="score-row">
          <p className="score-item">
            <span className="score-label">ROUNDS</span>
            <span className="score-num">{view.selfProgress.completedRounds} / {view.totalRounds}</span>
          </p>
          <p className="score-item">
            <span className="score-label">COINS</span>
            <span className="score-num">{view.selfProgress.totalCapturedCoins}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
