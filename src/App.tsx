import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import { CoinOpenFx } from './components/CoinOpenFx'
import { SoundToggle } from './components/SoundToggle'
import type { BagId } from './game/assets'
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
  const [fxSample, setFxSample] = useState<CoinFxSample | null>(null)
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())
  /** Short lock while COIN FX runs — prevents mixed bag origins. */
  const fxLockRef = useRef(false)
  const roundRef = useRef(round)
  const fxRunIdRef = useRef(0)

  useEffect(() => {
    roundRef.current = round
  }, [round])

  const clearCoinFx = useCallback(() => {
    fxLockRef.current = false
    setCoinFx(null)
    setFxSample(null)
  }, [])

  const opened = useMemo(() => openedBagIds(round.history), [round.history])

  const hiddenBagIds = useMemo(() => {
    if (!coinFx) return opened
    if (fxSample && fxSample.bagId === coinFx.bagId) {
      return visualHiddenBagIds(opened, fxSample)
    }
    // FX scheduled but first sample not yet applied — keep bag briefly.
    const next = new Set(opened)
    next.delete(coinFx.bagId)
    return next
  }, [opened, coinFx, fxSample])

  const handleBagTap = useCallback((bagId: BagId) => {
    if (fxLockRef.current) return
    if (openedGuardRef.current.has(bagId)) return

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
      setCoinFx({
        bagId,
        coinCount: contents.coinCount,
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
    clearCoinFx()
    setRound(createActiveRound())
  }, [clearCoinFx])

  const handleSoundToggle = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev
      writeSoundEnabled(next)
      return next
    })
  }, [])

  const handleFxSample = useCallback((sample: CoinFxSample) => {
    setFxSample(sample)
  }, [])

  const handleFxComplete = useCallback(() => {
    clearCoinFx()
  }, [clearCoinFx])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__3cbDev = {
      getRound: () => roundRef.current,
      startWithHand: (hand) => {
        openedGuardRef.current = new Set()
        clearCoinFx()
        setRound(createActiveRound(hand))
      },
      newRound: () => {
        openedGuardRef.current = new Set()
        clearCoinFx()
        setRound(createActiveRound())
      },
    }
    return () => {
      delete window.__3cbDev
    }
  }, [clearCoinFx])

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

  const canTapBags = isRoundActive(round) && !coinFx

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

      {endSummary ? (
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
            key={coinFx.runId}
            bagId={coinFx.bagId}
            bagCount={round.hand.bagCount}
            coinCount={coinFx.coinCount}
            onSample={handleFxSample}
            onComplete={handleFxComplete}
          />
        ) : null}
      </BagBoard>
    </main>
  )
}

export default App
