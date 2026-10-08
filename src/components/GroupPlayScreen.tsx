import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type { BagId } from '../game/assets'
import { warmBagOpenAudio } from '../game/bagAudio'
import { unlockCoinAudio } from '../game/coinAudio'
import { visualHiddenBagIds, type CoinFxSample, type FxCoinCount } from '../game/coinFx'
import type { BagCount } from '../game/formations'
import { startOpenPresentation } from '../game/startOpenPresentation'
import { readSoundEnabled } from '../game/sound'
import { bagIdToBagNumber, bagNumberToBagId } from '../duel/duelPlayClient'
import { createOptimisticOpenGate, markOptimisticFailed, markOptimisticFxDone, markOptimisticServerDone, type OptimisticOpenGate } from '../duel/duelOptimisticOpen'
import {
  canShowGroupCashOutButton,
  isGroupCashOutButtonDisabled,
} from '../group/groupCashOutUi'
import type { GroupLocalOpenResult } from '../group/groupDomain'
import type {
  GroupCashOutResult,
  GroupOpenResult,
  GroupPlayReady,
  GroupProgress,
  GroupResult,
  createGroupPlayBootstrapCoordinator,
} from '../group/groupPlayClient'
import { BagBoard } from './BagBoard'
import { BombOpenFx } from './BombOpenFx'
import { CoinOpenFx } from './CoinOpenFx'
import { EmptyOpenFx } from './EmptyOpenFx'
import { GroupCompletionWaiting } from './GroupCompletionWaiting'

type Coordinator = ReturnType<typeof createGroupPlayBootstrapCoordinator>
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

export function GroupPlayScreen({ initialReady, coordinator, t, onResult }: { initialReady: GroupPlayReady; coordinator: Coordinator; t: AppStrings; onResult:(result:GroupResult)=>void }) {
  const [ready, setReady] = useState(initialReady)
  const [openedResults, setOpenedResults] = useState<readonly GroupOpenResult[]>([])
  const [provisionalCoins, setProvisionalCoins] = useState<0 | 1 | 2 | 3>(0)
  const [terminal, setTerminal] = useState<GroupOpenResult | GroupCashOutResult | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [retryBag, setRetryBag] = useState<BagId | null>(null)
  const [error, setError] = useState(false)
  const [cashOutError, setCashOutError] = useState(false)
  const [fx, setFx] = useState<ActiveFx | null>(null)
  const [coinFxSample, setCoinFxSample] = useState<CoinFxSample | null>(null)
  const [completionSeed, setCompletionSeed] = useState<GroupProgress | null>(null)
  const [completionReady, setCompletionReady] = useState(false)
  const lockRef = useRef(false)
  const gateRef = useRef<OptimisticOpenGate | null>(null)
  const runIdRef = useRef(0)
  const completionFetchRef = useRef(false)
  const opened = useMemo(() => new Set(openedResults.map((entry) => bagNumberToBagId(entry.bagNumber))), [openedResults])
  const hidden = useMemo(() => {
    const visual = new Set(opened)
    if (fx?.kind === 'coins') {
      visual.add(fx.bagId)
      return coinFxSample?.bagId === fx.bagId ? visualHiddenBagIds(visual, coinFxSample) : opened
    }
    if (fx) visual.add(fx.bagId)
    return visual
  }, [opened, fx, coinFxSample])

  const unlock = useCallback(() => {
    gateRef.current = null; lockRef.current = false; setRequestPending(false); setFx(null); setCoinFxSample(null)
  }, [])
  const fxComplete = useCallback(() => {
    const gate = gateRef.current
    if (!gate || gate.failed || markOptimisticFxDone(gate)) unlock()
  }, [unlock])
  const startFx = useCallback((local: GroupLocalOpenResult, bagId: BagId, coins: number) => {
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
  }, [])

  const tap = useCallback(async (bagId: BagId) => {
    if (lockRef.current || requestPending || terminal || opened.has(bagId) || (retryBag && retryBag !== bagId)) return
    const bagNumber = bagIdToBagNumber(bagId)
    const pending = coordinator.getPendingOpen()
    if (pending && (pending.groupId !== ready.state.groupId || pending.bagNumber !== bagNumber)) { setError(true); return }
    if (coordinator.getPendingCashOut()) { setCashOutError(true); return }
    const local = coordinator.getLocalOpenResult(ready.state.groupId, ready.currentPlacement.roundNumber, ready.currentPlacement.bagCount, bagNumber)
    unlockCoinAudio(); warmBagOpenAudio(); lockRef.current = true; setRequestPending(true); setError(false); setCashOutError(false)
    const gate = createOptimisticOpenGate(); gateRef.current = gate
    if (retryBag === bagId) markOptimisticFxDone(gate)
    else startFx(local, bagId, provisionalCoins)
    try {
      const result = await coordinator.open(ready.state.groupId, bagNumber)
      if (local.outcome !== result.outcome || local.coinsFound !== result.coinsFound || result.roundNumber !== ready.currentPlacement.roundNumber || result.openOrder !== openedResults.length + 1) throw new Error('mismatch')
      setRetryBag(null); setOpenedResults((current) => [...current, result]); setProvisionalCoins(result.provisionalCoins)
      if (result.roundEnded) setTerminal(result)
      if (markOptimisticServerDone(gate)) unlock()
    } catch {
      markOptimisticFailed(gate); setRetryBag(bagId); setError(true)
      if (gate.fxDone) unlock()
    }
  }, [coordinator, ready, opened, openedResults.length, provisionalCoins, requestPending, retryBag, terminal, startFx, unlock])

  const cashOut = useCallback(async () => {
    if (lockRef.current || requestPending || fx || terminal || (provisionalCoins !== 1 && provisionalCoins !== 2)) return
    if (coordinator.getPendingOpen()) { setError(true); return }
    lockRef.current = true; setRequestPending(true); setCashOutError(false); setError(false)
    try {
      const result = await coordinator.cashOut(ready.state.groupId)
      if (result.roundNumber !== ready.currentPlacement.roundNumber || result.capturedCoins !== provisionalCoins || result.openedBagCount !== openedResults.length) throw new Error('mismatch')
      setTerminal(result); setRetryBag(null)
    } catch { setCashOutError(true) }
    finally { lockRef.current = false; setRequestPending(false) }
  }, [coordinator, ready, provisionalCoins, openedResults.length, requestPending, fx, terminal])

  const next = useCallback(async () => {
    if (!terminal || requestPending || fx || lockRef.current || ready.currentPlacement.roundNumber >= ready.state.totalRounds) return
    setRequestPending(true); setError(false)
    try { const nextReady = await coordinator.startNext(ready.state.groupId); setReady(nextReady); setOpenedResults([]); setProvisionalCoins(0); setTerminal(null); setRetryBag(null) }
    catch { setError(true) }
    finally { setRequestPending(false) }
  }, [coordinator, ready, terminal, requestPending, fx])

  const wantsCompletion =
    terminal !== null &&
    ready.currentPlacement.roundNumber === ready.state.totalRounds &&
    !fx &&
    !requestPending

  useEffect(() => {
    if (!wantsCompletion || completionFetchRef.current) return
    completionFetchRef.current = true
    let cancelled = false
    void coordinator
      .getProgress(ready.state.groupId)
      .then((progress) => {
        if (cancelled) return
        setCompletionSeed(progress)
        setCompletionReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setCompletionSeed(null)
        setCompletionReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [wantsCompletion, coordinator, ready.state.groupId])

  const soundEnabled = readSoundEnabled()
  const showCashOut = canShowGroupCashOutButton(provisionalCoins, terminal !== null)
  const cashOutDisabled = isGroupCashOutButtonDisabled(requestPending, fx !== null)
  if (completionReady) {
    return (
      <GroupCompletionWaiting
        groupId={ready.state.groupId}
        coordinator={coordinator}
        t={t}
        onResult={onResult}
        initialProgress={completionSeed}
        initialClosed={completionSeed?.status === 'closed'}
      />
    )
  }
  return <div className="duel-play">
    <p className="duel-round-index">{t.groupRoundLabel} <span className="duel-num">{ready.currentPlacement.roundNumber}</span>{' / '}<span className="duel-num">{ready.state.totalRounds}</span></p>
    <BagBoard bagCount={ready.currentPlacement.bagCount as BagCount} hiddenBagIds={hidden} onBagTap={tap} interactive={!requestPending && !terminal}>
      {fx?.kind === 'coins' ? <CoinOpenFx key={fx.runId} bagId={fx.bagId} bagCount={ready.currentPlacement.bagCount as BagCount} coinCount={fx.count} clearsRound={fx.clearsRound} soundEnabled={soundEnabled} presentationGen={fx.presentationGen} onSample={setCoinFxSample} onComplete={fxComplete} /> : null}
      {fx?.kind === 'empty' ? <EmptyOpenFx key={fx.runId} bagId={fx.bagId} bagCount={ready.currentPlacement.bagCount as BagCount} presentationGen={fx.presentationGen} onComplete={fxComplete} /> : null}
      {fx?.kind === 'bomb' ? <BombOpenFx key={fx.runId} bagId={fx.bagId} bagCount={ready.currentPlacement.bagCount as BagCount} hiddenBagIds={hidden} soundEnabled={soundEnabled} presentationGen={fx.presentationGen} onComplete={fxComplete} /> : null}
    </BagBoard>
    <div className="field-action" aria-live="polite">
      {showCashOut ? (
        <button
          type="button"
          className="dev-btn cash-out-btn"
          disabled={cashOutDisabled}
          onClick={() => { void cashOut() }}
        >
          {t.cashOut}
        </button>
      ) : null}
      {terminal && ready.currentPlacement.roundNumber < ready.state.totalRounds ? <button type="button" className="dev-btn end-action-btn standard-round-action-btn standard-round-action-btn--next-round" disabled={requestPending || !!fx} onClick={() => { void next() }}>{t.nextRound}</button> : null}
    </div>
    {error || cashOutError ? (
      <div
        className="duel-play-error stable-message-slot stable-message-slot--play-error"
        role="alert"
      >
        {error ? <p>{t.groupPlayError}</p> : null}
        {cashOutError ? <p>{t.duelCashOutRetry}</p> : null}
      </div>
    ) : null}
  </div>
}
