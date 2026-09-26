import { bombSrc, coinSrc, type BagId } from '../game/assets'
import {
  REVEAL_BOMB_SIZE_FRAC,
  REVEAL_COIN_SIZE_FRAC,
  type RevealPlan,
} from '../game/reveal'
import './RevealBoard.css'

type RevealBoardProps = {
  plan: RevealPlan
}

/**
 * Static REVEAL overlay for still-unopened bags — no animation, no audio.
 * Sprites sit on formation slot geometric centers (no bag visual-center bias).
 */
export function RevealBoard({ plan }: RevealBoardProps) {
  return (
    <div className="reveal-board" aria-hidden="true">
      {plan.sprites.map((sprite) => {
        if (sprite.kind === 'bomb') {
          return (
            <RevealBomb
              key={`reveal-bomb-${sprite.bagId}`}
              bagId={sprite.bagId}
              slotX={sprite.slotX}
              slotY={sprite.slotY}
              offsetXBag={sprite.offsetXBag}
              offsetYBag={sprite.offsetYBag}
              depthZIndex={sprite.depthZIndex}
            />
          )
        }
        return (
          <RevealCoin
            key={`reveal-coin-${sprite.bagId}-${sprite.coinIndex}`}
            bagId={sprite.bagId}
            slotX={sprite.slotX}
            slotY={sprite.slotY}
            offsetXBag={sprite.offsetXBag}
            offsetYBag={sprite.offsetYBag}
            depthZIndex={sprite.depthZIndex}
            stackZ={sprite.stackZ}
          />
        )
      })}
    </div>
  )
}

function RevealCoin({
  bagId,
  slotX,
  slotY,
  offsetXBag,
  offsetYBag,
  depthZIndex,
  stackZ,
}: {
  bagId: BagId
  slotX: number
  slotY: number
  offsetXBag: number
  offsetYBag: number
  depthZIndex: number
  stackZ: number
}) {
  const ox = `calc(var(--bag-size) * ${offsetXBag})`
  const oy = `calc(var(--bag-size) * ${offsetYBag})`
  return (
    <div
      className="reveal-coin"
      data-bag-id={bagId}
      data-reveal-kind="coin"
      style={{
        left: `${slotX}%`,
        top: `${slotY}%`,
        zIndex: depthZIndex * 10 + stackZ,
        width: `calc(var(--bag-size) * ${REVEAL_COIN_SIZE_FRAC})`,
        ['--reveal-ox' as string]: ox,
        ['--reveal-oy' as string]: oy,
      }}
    >
      <img
        className="reveal-coin-img"
        src={coinSrc('coin-1')}
        alt=""
        draggable={false}
      />
    </div>
  )
}

function RevealBomb({
  bagId,
  slotX,
  slotY,
  offsetXBag,
  offsetYBag,
  depthZIndex,
}: {
  bagId: BagId
  slotX: number
  slotY: number
  offsetXBag: number
  offsetYBag: number
  depthZIndex: number
}) {
  const ox = `calc(var(--bag-size) * ${offsetXBag})`
  const oy = `calc(var(--bag-size) * ${offsetYBag})`
  return (
    <div
      className="reveal-bomb"
      data-bag-id={bagId}
      data-reveal-kind="bomb"
      style={{
        left: `${slotX}%`,
        top: `${slotY}%`,
        zIndex: depthZIndex * 10,
        width: `calc(var(--bag-size) * ${REVEAL_BOMB_SIZE_FRAC})`,
        ['--reveal-ox' as string]: ox,
        ['--reveal-oy' as string]: oy,
      }}
    >
      <img
        className="reveal-bomb-img"
        src={bombSrc('bomb-off')}
        alt=""
        draggable={false}
      />
    </div>
  )
}
