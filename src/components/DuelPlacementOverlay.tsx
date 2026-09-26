import { bombSrc, coinSrc, type BagId } from '../game/assets'
import {
  bagSlotDepthZIndex,
  getFormation,
  type BagCount,
} from '../game/formations'
import {
  REVEAL_BOMB_SIZE_FRAC,
  REVEAL_COIN_SIZE_FRAC,
  REVEAL_COIN_STACK_OFFSETS,
} from '../game/reveal'
import './DuelPlacementOverlay.css'

type DuelPlacementOverlayProps = {
  bagCount: BagCount
  bombBagId: BagId | null
  coinCountsByBag: Readonly<Partial<Record<BagId, 1 | 2 | 3>>>
}

/**
 * Static BOMB / COIN markers on top of bags (no animation / no SE).
 * Reuses REVEAL stack offsets so ×1/×2/×3 stay countable.
 */
export function DuelPlacementOverlay({
  bagCount,
  bombBagId,
  coinCountsByBag,
}: DuelPlacementOverlayProps) {
  const slots = getFormation(bagCount)

  return (
    <div className="duel-place-overlay" aria-hidden="true">
      {slots.map((slot) => {
        const depth = bagSlotDepthZIndex(slot.y)
        const coins = coinCountsByBag[slot.bagId]
        const showBomb = bombBagId === slot.bagId

        return (
          <div key={slot.bagId}>
            {showBomb ? (
              <div
                className="duel-place-bomb"
                style={{
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  zIndex: depth + 20,
                  width: `calc(var(--bag-size) * ${REVEAL_BOMB_SIZE_FRAC})`,
                }}
              >
                <img
                  className="duel-place-img"
                  src={bombSrc('bomb-off')}
                  alt=""
                  draggable={false}
                />
              </div>
            ) : null}
            {coins
              ? REVEAL_COIN_STACK_OFFSETS[coins].map((o, i) => (
                  <div
                    key={`${slot.bagId}-c${i}`}
                    className="duel-place-coin"
                    style={{
                      left: `${slot.x}%`,
                      top: `${slot.y}%`,
                      zIndex: depth + 30 + i,
                      width: `calc(var(--bag-size) * ${REVEAL_COIN_SIZE_FRAC})`,
                      ['--duel-ox' as string]: `calc(var(--bag-size) * ${o.x})`,
                      ['--duel-oy' as string]: `calc(var(--bag-size) * ${o.y})`,
                    }}
                  >
                    <img
                      className="duel-place-img"
                      src={coinSrc('coin-1')}
                      alt=""
                      draggable={false}
                    />
                  </div>
                ))
              : null}
          </div>
        )
      })}
    </div>
  )
}
