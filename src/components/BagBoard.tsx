import { bagSrc, type BagId } from '../game/assets'
import { getFormation, type BagCount } from '../game/formations'
import './BagBoard.css'

type BagBoardProps = {
  bagCount: BagCount
  /** Preview / future gameplay: one click or tap selects a bag. */
  onBagTap?: (bagId: BagId) => void
}

export function BagBoard({ bagCount, onBagTap }: BagBoardProps) {
  const slots = getFormation(bagCount)

  return (
    <div
      className="bag-board"
      data-bag-count={bagCount}
      aria-label={`${bagCount} bags`}
    >
      {slots.map((slot) => (
        <div
          key={slot.bagId}
          className="bag-slot"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            // Front (larger y) paints above back so light overlaps read naturally
            zIndex: Math.round(slot.y),
          }}
          data-bag-id={slot.bagId}
        >
          <img
            className="bag-image"
            src={bagSrc(slot.bagId)}
            alt=""
            draggable={false}
          />
          {/*
            Hit target is inset toward the opaque bag body so transparent WebP
            padding / corners do not steal taps from neighbors. Visual size unchanged.
          */}
          <button
            type="button"
            className="bag-hit"
            aria-label="Bag"
            onClick={() => onBagTap?.(slot.bagId)}
          />
        </div>
      ))}
    </div>
  )
}
