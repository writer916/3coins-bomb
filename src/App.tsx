import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import { BombOpenFx } from './components/BombOpenFx'
import { CoinOpenFx } from './components/CoinOpenFx'
import { EmptyOpenFx } from './components/EmptyOpenFx'
import { SoundToggle } from './components/SoundToggle'
import type { BagId } from './game/assets'
import { unlockCoinAudio } from './game/coinAudio'
import {
  visualHiddenBagIds,
  type CoinFxSample,
  type FxCoinCount,
} from './game/coinFx'
import type { HiddenHand } from './game/hand'
import { openedBagIds } from './game/open'
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
}

type ActiveCoinFx = {
  bagId: BagId
  coinCount: FxCoinCount
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
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())
  /** Short lock while open FX runs — prevents mixed bag origins. */
  const fxLockRef = useRef(false)
  const roundRef = useRef(round)
  const fxRunIdRef = useRef(0)

  useEffect(() => {
    roundRef.current = round
  }, [round])

  const clearOpenFx = useCallback(() => {
    fxLockRef.current = false
    setCoinFx(null)
    setBombFx(null)
    setEmptyFx(null)
    setFxSample(null)
  }, [])

  const opened = useMemo(() => openedBagIds(round.history), [round.history])

  const hiddenBagIds = useMemo(() => {
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
  }, [opened, coinFx, bombFx, emptyFx, fxSample])

  const handleBagTap = useCallback((bagId: BagId) => {
    if (fxLockRef.current) return
    if (openedGuardRef.current.has(bagId)) return

    unlockCoinAudio()

    const prev = roundRef.current
    if (!isRoundActive(prev)) return

    const result = applyOpenBag(prev, bagId)
    if (!result.ok) return

    openedGuardRef.current.add(bagId)
    setRound(result.state)

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
    setRound(createActiveRound())
  }, [clearOpenFx])

  const handleSoundToggle = useCallback(() => {
    unlockCoinAudio()
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
      startWithHand: (hand) => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        setRound(createActiveRound(hand))
      },
      newRound: () => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        setRound(createActiveRound())
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

      <button type="button" className="dev-btn" onClick={handleNewRound}>
        {t.newRound}
      </button>

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

      <BagBoard
        bagCount={round.hand.bagCount}
        hiddenBagIds={hiddenBagIds}
        onBagTap={canTapBags ? handleBagTap : undefined}
      >
        {coinFx ? (
          <CoinOpenFx
            key={`coin-${coinFx.runId}`}
            bagId={coinFx.bagId}
            bagCount={round.hand.bagCount}
            coinCount={coinFx.coinCount}
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
