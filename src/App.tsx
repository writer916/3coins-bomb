import { useState } from 'react'
import { BagBoard } from './components/BagBoard'
import { BAG_COUNTS, type BagCount } from './game/formations'
import './App.css'

const DEFAULT_BAG_COUNT: BagCount = 8

function App() {
  const [bagCount, setBagCount] = useState<BagCount>(DEFAULT_BAG_COUNT)

  return (
    <main className="app">
      <header className="app-header">
        <h1>3 COINS BOMB</h1>
        <p className="tagline">3 COINS. 1 BOMB.</p>
      </header>

      <div
        className="bag-count-controls"
        role="group"
        aria-label="Bag count preview"
      >
        {BAG_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            className={
              count === bagCount
                ? 'bag-count-btn bag-count-btn--active'
                : 'bag-count-btn'
            }
            aria-pressed={count === bagCount}
            onClick={() => setBagCount(count)}
          >
            {count}
          </button>
        ))}
      </div>

      <BagBoard bagCount={bagCount} />
    </main>
  )
}

export default App
