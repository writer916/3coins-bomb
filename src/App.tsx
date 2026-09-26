import { useCallback, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import type { BagId } from './game/assets'
import { generateSoloSystemHand, type HiddenHand } from './game/hand'
import {
  formatOpenResultLabel,
  openedBagIds,
  tryOpenBag,
  type OpenReveal,
} from './game/open'
import './App.css'

type RoundState = {
  hand: HiddenHand
  history: readonly OpenReveal[]
  lastReveal: OpenReveal | null
}

function createRound(): RoundState {
  return {
    hand: generateSoloSystemHand(),
    history: [],
    lastReveal: null,
  }
}

function App() {
  const [round, setRound] = useState<RoundState>(() => createRound())
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())

  const hiddenBagIds = useMemo(
    () => openedBagIds(round.history),
    [round.history],
  )

  const handleBagTap = useCallback((bagId: BagId) => {
    if (openedGuardRef.current.has(bagId)) return
    openedGuardRef.current.add(bagId)

    setRound((prev) => {
      const result = tryOpenBag(prev.hand, prev.history, bagId)
      if (!result.ok) {
        openedGuardRef.current.delete(bagId)
        return prev
      }
      return {
        hand: prev.hand,
        history: result.history,
        lastReveal: result.reveal,
      }
    })
  }, [])

  const handleNewRound = useCallback(() => {
    openedGuardRef.current = new Set()
    setRound(createRound())
  }, [])

  return (
    <main className="app">
      <header className="app-header">
        <h1>3 COINS BOMB</h1>
        <p className="tagline">3 COINS. 1 BOMB.</p>
      </header>

      <p className="round-meta">{round.hand.bagCount} bags</p>

      <button type="button" className="dev-btn" onClick={handleNewRound}>
        New ROUND
      </button>

      <p className="open-result" aria-live="polite">
        {round.lastReveal
          ? formatOpenResultLabel(round.lastReveal.contents)
          : '—'}
      </p>

      <BagBoard
        bagCount={round.hand.bagCount}
        hiddenBagIds={hiddenBagIds}
        onBagTap={handleBagTap}
      />
    </main>
  )
}

export default App
