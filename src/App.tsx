import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import { BombOpenFx } from './components/BombOpenFx'
import { CoinOpenFx } from './components/CoinOpenFx'
import { EmptyOpenFx } from './components/EmptyOpenFx'
import { RevealBoard } from './components/RevealBoard'
import { SoundToggle } from './components/SoundToggle'
import type { BagId } from './game/assets'
import { unlockCoinAudio } from './game/coinAudio'
import { playBagOpen, warmBagOpenAudio } from './game/bagAudio'
import { resolveBagOpenSeRequest } from './game/bagSfx'
import {
  visualHiddenBagIds,
  type CoinFxSample,
  type FxCoinCount,
} from './game/coinFx'
import { bagsForCount } from './game/formations'
import type { HiddenHand } from './game/hand'
import { openedBagIds } from './game/open'
import {
  buildRevealPlan,
  canRequestReveal,
  canShowEndActions,
} from './game/reveal'
import {
  applyOpenBag,
  canCashOut,
  createActiveRound,
  isRoundActive,
  tryCashOut,
  type RoundState,
} from './game/round'
import { readSoundEnabled, writeSoundEnabled } from './game/sound'
import { DEFAULT_LOCALE, getStrings } from './i18n'
import './App.css'

type DevRoundApi = {
  getRound: () => RoundState
  startWithHand: (hand: HiddenHand) => void
  newRound: () => void
  /** DEV: jump to FULL REVEAL for a fixed hand (no FX / no SE). */
  previewFullReveal: (hand: HiddenHand) => void
  getRevealed: () => boolean
}

type ActiveCoinFx = {
  bagId: BagId
  coinCount: FxCoinCount
  /** This open caused phase=cleared (3 COINS). */
  clearsRound: boolean
  runId: number
}

type ActiveBombFx = {
  bagId: BagId
  runId: number
}

type ActiveEmptyFx = {
  bagId: BagId
  runId: number
}

declare global {
  interface Window {
    __3cbDev?: DevRoundApi
  }
}

function App() {
  const t = getStrings(DEFAULT_LOCALE)
  const [round, setRound] = useState<RoundState>(() => createActiveRound())
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled())
  const [coinFx, setCoinFx] = useState<ActiveCoinFx | null>(null)
  const [bombFx, setBombFx] = useState<ActiveBombFx | null>(null)
  const [emptyFx, setEmptyFx] = useState<ActiveEmptyFx | null>(null)
  const [fxSample, setFxSample] = useState<CoinFxSample | null>(null)
  /** FULL REVEAL toggled after ROUND end (optional). */
  const [revealed, setRevealed] = useState(false)
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())
  /** Short lock while open FX runs — prevents mixed bag origins. */
  const fxLockRef = useRef(false)
  const roundRef = useRef(round)
  const revealedRef = useRef(revealed)
  const fxRunIdRef = useRef(0)
  const soundOnRef = useRef(soundOn)

  useEffect(() => {
    roundRef.current = round
  }, [round])

  useEffect(() => {
    revealedRef.current = revealed
  }, [revealed])

  useEffect(() => {
    soundOnRef.current = soundOn
  }, [soundOn])

  const clearOpenFx = useCallback(() => {
    fxLockRef.current = false
    setCoinFx(null)
    setBombFx(null)
    setEmptyFx(null)
    setFxSample(null)
  }, [])

  const opened = useMemo(() => openedBagIds(round.history), [round.history])

  const allBagIds = useMemo(
    () => new Set(bagsForCount(round.hand.bagCount)),
    [round.hand.bagCount],
  )

  const hiddenBagIds = useMemo(() => {
    // FULL REVEAL: every bag image gone — contents overlay only.
    if (revealed) return allBagIds

    // BOMB / EMPTY: bag gone immediately (opened already includes bagId).
    if (bombFx || emptyFx) return opened

    if (!coinFx) return opened
    if (fxSample && fxSample.bagId === coinFx.bagId) {
      return visualHiddenBagIds(opened, fxSample)
    }
    // COIN FX scheduled but first sample not yet applied — keep bag briefly.
    const next = new Set(opened)
    next.delete(coinFx.bagId)
    return next
  }, [revealed, allBagIds, opened, coinFx, bombFx, emptyFx, fxSample])

  const openFxActive = coinFx !== null || bombFx !== null || emptyFx !== null
  const showEndActions = canShowEndActions(round.phase, openFxActive)
  const showRevealBtn = canRequestReveal(round.phase, openFxActive, revealed)

  const revealPlan = useMemo(
    () => (revealed ? buildRevealPlan(round.hand, round.history) : null),
    [revealed, round.hand, round.history],
  )

  const handleBagTap = useCallback((bagId: BagId) => {
    if (fxLockRef.current) return
    if (openedGuardRef.current.has(bagId)) return

    // Unlock + async warm (coin + bag preload). Do NOT sync-load bag here —
    // load() immediately before playBagOpen races and stalls currentTime.
    unlockCoinAudio()

    const prev = roundRef.current
    if (!isRoundActive(prev)) return

    const result = applyOpenBag(prev, bagId)
    if (!result.ok) return

    openedGuardRef.current.add(bagId)
    setRound(result.state)

    const bagSe = resolveBagOpenSeRequest(soundOnRef.current, true)
    if (bagSe.play) {
      playBagOpen({ soundEnabled: true })
    }

    const contents = result.reveal.contents
    if (contents.kind === 'coins') {
      fxLockRef.current = true
      fxRunIdRef.current += 1
      setFxSample(null)
      setBombFx(null)
      setEmptyFx(null)
      setCoinFx({
        bagId,
        coinCount: contents.coinCount,
        clearsRound: result.state.phase === 'cleared',
        runId: fxRunIdRef.current,
      })
    } else if (contents.kind === 'bomb') {
      fxLockRef.current = true
      fxRunIdRef.current += 1
      setFxSample(null)
      setCoinFx(null)
      setEmptyFx(null)
      setBombFx({
        bagId,
        runId: fxRunIdRef.current,
      })
    } else if (contents.kind === 'empty') {
      fxLockRef.current = true
      fxRunIdRef.current += 1
      setFxSample(null)
      setCoinFx(null)
      setBombFx(null)
      setEmptyFx({
        bagId,
        runId: fxRunIdRef.current,
      })
    }
  }, [])

  const handleCashOut = useCallback(() => {
    setRound((prev) => {
      const result = tryCashOut(prev)
      return result.ok ? result.state : prev
    })
  }, [])

  const handleNewRound = useCallback(() => {
    openedGuardRef.current = new Set()
    clearOpenFx()
    setRevealed(false)
    setRound(createActiveRound())
  }, [clearOpenFx])

  const handleReveal = useCallback(() => {
    if (!canRequestReveal(roundRef.current.phase, fxLockRef.current, revealedRef.current)) {
      return
    }
    // Instant, silent — no SE / no FX.
    setRevealed(true)
  }, [])

  const handleSoundToggle = useCallback(() => {
    unlockCoinAudio()
    warmBagOpenAudio()
    setSoundOn((prev) => {
      const next = !prev
      writeSoundEnabled(next)
      return next
    })
  }, [])

  const handleCoinFxSample = useCallback((sample: CoinFxSample) => {
    setFxSample(sample)
  }, [])

  const handleCoinFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  const handleBombFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  const handleEmptyFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__3cbDev = {
      getRound: () => roundRef.current,
      getRevealed: () => revealedRef.current,
      startWithHand: (hand) => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        setRevealed(false)
        setRound(createActiveRound(hand))
      },
      newRound: () => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        setRevealed(false)
        setRound(createActiveRound())
      },
      previewFullReveal: (hand) => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        // Settled cashed-out shell so end actions / reveal UI appear without FX.
        setRound({
          hand,
          history: [],
          lastReveal: null,
          phase: 'cashed-out',
          provisionalCoins: 1,
          capturedCoins: 1,
        })
        setRevealed(true)
      },
    }
    return () => {
      delete window.__3cbDev
    }
  }, [clearOpenFx])

  const resultLine = (() => {
    if (!round.lastReveal) return t.dash
    const c = round.lastReveal.contents
    if (c.kind === 'empty') return t.resultEmpty
    if (c.kind === 'bomb') return t.resultBomb
    return t.resultCoin(c.coinCount)
  })()

  const endSummary = (() => {
    if (round.phase === 'active') return null
    if (round.phase === 'bombed') {
      return `${t.roundBombed}\n${t.capturedCoins(0)}`
    }
    if (round.phase === 'cleared') {
      return `${t.roundCleared}\n${t.capturedCoins(3)}`
    }
    return `${t.roundCashedOut}\n${t.capturedCoins(round.capturedCoins ?? 0)}`
  })()

  // ROUND already ended on bomb; also block while any open FX runs.
  const canTapBags = isRoundActive(round) && !coinFx && !bombFx && !emptyFx
  // Avoid stacking end copy over the local bomb reveal.
  const showEndSummary = endSummary !== null && !bombFx

  return (
    <main className="app">
      <div className="app-topbar">
        <SoundToggle
          enabled={soundOn}
          onToggle={handleSoundToggle}
          labelOn={t.soundOn}
          labelOff={t.soundOff}
        />
      </div>

      <header className="app-header">
        <h1>{t.brandTitle}</h1>
        <p className="tagline">{t.brandTagline}</p>
      </header>

      <p className="round-meta">{t.bagsMeta(round.hand.bagCount)}</p>

      {isRoundActive(round) ? (
        <button type="button" className="dev-btn" onClick={handleNewRound}>
          {t.newRound}
        </button>
      ) : null}

      <p className="provisional" aria-live="polite">
        {t.provisionalCoins(round.provisionalCoins)}
      </p>

      {canCashOut(round) ? (
        <button type="button" className="dev-btn cash-out-btn" onClick={handleCashOut}>
          {t.cashOut}
        </button>
      ) : null}

      <p className="open-result" aria-live="polite">
        {resultLine}
      </p>

      {showEndSummary ? (
        <p className="round-end" aria-live="polite">
          {endSummary}
        </p>
      ) : null}

      {showEndActions ? (
        <div className="end-actions">
          {showRevealBtn ? (
            <button
              type="button"
              className="dev-btn end-action-reveal"
              onClick={handleReveal}
            >
              {t.reveal}
            </button>
          ) : null}
          <button
            type="button"
            className="dev-btn end-action-next"
            onClick={handleNewRound}
          >
            {t.nextRound}
          </button>
        </div>
      ) : null}

      <BagBoard
        bagCount={round.hand.bagCount}
        hiddenBagIds={hiddenBagIds}
        onBagTap={canTapBags ? handleBagTap : undefined}
      >
        {revealPlan ? <RevealBoard plan={revealPlan} /> : null}
        {coinFx ? (
          <CoinOpenFx
            key={`coin-${coinFx.runId}`}
            bagId={coinFx.bagId}
            bagCount={round.hand.bagCount}
            coinCount={coinFx.coinCount}
            clearsRound={coinFx.clearsRound}
            soundEnabled={soundOn}
            onSample={handleCoinFxSample}
            onComplete={handleCoinFxComplete}
          />
        ) : null}
        {bombFx ? (
          <BombOpenFx
            key={`bomb-${bombFx.runId}`}
            bagId={bombFx.bagId}
            bagCount={round.hand.bagCount}
            hiddenBagIds={hiddenBagIds}
            soundEnabled={soundOn}
            onComplete={handleBombFxComplete}
          />
        ) : null}
        {emptyFx ? (
          <EmptyOpenFx
            key={`empty-${emptyFx.runId}`}
            bagId={emptyFx.bagId}
            bagCount={round.hand.bagCount}
            onComplete={handleEmptyFxComplete}
          />
        ) : null}
      </BagBoard>
    </main>
  )
}

export default App
