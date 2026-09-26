import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import type { BagId } from './game/assets'
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
import { DEFAULT_LOCALE, getStrings } from './i18n'
import './App.css'

type DevRoundApi = {
  getRound: () => RoundState
  startWithHand: (hand: HiddenHand) => void
  newRound: () => void
}

declare global {
  interface Window {
    __3cbDev?: DevRoundApi
  }
}

function App() {
  const t = getStrings(DEFAULT_LOCALE)
  const [round, setRound] = useState<RoundState>(() => createActiveRound())
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())
  const roundRef = useRef(round)

  useEffect(() => {
    roundRef.current = round
  }, [round])

  const hiddenBagIds = useMemo(
    () => openedBagIds(round.history),
    [round.history],
  )

  const handleBagTap = useCallback((bagId: BagId) => {
    if (openedGuardRef.current.has(bagId)) return

    setRound((prev) => {
      if (!isRoundActive(prev)) return prev

      const result = applyOpenBag(prev, bagId)
      if (!result.ok) return prev

      openedGuardRef.current.add(bagId)
      return result.state
    })
  }, [])

  const handleCashOut = useCallback(() => {
    setRound((prev) => {
      const result = tryCashOut(prev)
      return result.ok ? result.state : prev
    })
  }, [])

  const handleNewRound = useCallback(() => {
    openedGuardRef.current = new Set()
    setRound(createActiveRound())
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__3cbDev = {
      getRound: () => roundRef.current,
      startWithHand: (hand) => {
        openedGuardRef.current = new Set()
        setRound(createActiveRound(hand))
      },
      newRound: () => {
        openedGuardRef.current = new Set()
        setRound(createActiveRound())
      },
    }
    return () => {
      delete window.__3cbDev
    }
  }, [])

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

  return (
    <main className="app">
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
        onBagTap={isRoundActive(round) ? handleBagTap : undefined}
      />
    </main>
  )
}

export default App
