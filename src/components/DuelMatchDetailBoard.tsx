import {
  assertDetailBagCount,
  bagNumberToDetailBagId,
  buildDuelMatchDetailOpenMarkers,
  coinCountsByBagFromNumbers,
  type DuelMatchDetailOpenInput,
} from '../game/duelMatchDetailBoardModel'
import { BagBoard } from './BagBoard'
import { DuelPlacementOverlay } from './DuelPlacementOverlay'
import './DuelMatchDetailBoard.css'

export type DuelMatchDetailBoardProps = {
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly number[]
  readonly opens: readonly DuelMatchDetailOpenInput[]
}

/**
 * One ROUND of completed DUEL match detail:
 * final LOCK placement (all bags + BOMB + COINs) with OPEN-order markers.
 * Read-only — no taps, FX, SE, or network.
 */
export function DuelMatchDetailBoard({
  bagCount: bagCountValue,
  bombBagNumber,
  coinBagNumbers,
  opens,
}: DuelMatchDetailBoardProps) {
  const bagCount = assertDetailBagCount(bagCountValue)
  const bombBagId = bagNumberToDetailBagId(bombBagNumber)
  const coinCountsByBag = coinCountsByBagFromNumbers(coinBagNumbers)
  const markers = buildDuelMatchDetailOpenMarkers(bagCount, opens)

  return (
    <div
      className="duel-match-detail-board"
      data-duel-match-detail-board=""
      data-bag-count={bagCount}
    >
      <BagBoard bagCount={bagCount} interactive={false}>
        <DuelPlacementOverlay
          bagCount={bagCount}
          bombBagId={bombBagId}
          coinCountsByBag={coinCountsByBag}
        />
        <div className="duel-detail-open-overlay" aria-hidden="true">
          {markers.map((marker) => (
            <span
              key={`${marker.openOrder}-${marker.bagNumber}`}
              className={
                marker.side === 'above'
                  ? 'duel-detail-open-marker duel-detail-open-marker--above'
                  : 'duel-detail-open-marker duel-detail-open-marker--below'
              }
              style={{
                left: `${marker.x}%`,
                top: `${marker.y}%`,
              }}
              data-open-order={marker.openOrder}
              data-bag-number={marker.bagNumber}
              data-open-side={marker.side}
            >
              <span className="duel-num">{marker.openOrder}</span>
            </span>
          ))}
        </div>
      </BagBoard>
    </div>
  )
}
