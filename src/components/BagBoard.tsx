import { useEffect, useState, type ReactNode } from 'react'
import { bagSrc, type BagId } from '../game/assets'
import {
  BAG_IMAGE_PREP_TIMEOUT_MS,
  prepareBagImages,
} from '../game/bagImagePrep'
import {
  bagSlotDepthZIndex,
  getFormation,
  type BagCount,
} from '../game/formations'
import './BagBoard.css'

type BagBoardProps = {
  bagCount: BagCount
  /** Opened bags are omitted from the board; their slots stay empty (no reflow). */
  hiddenBagIds?: ReadonlySet<BagId>
  /** Preview / gameplay: one click or tap selects a visible bag. */
  onBagTap?: (bagId: BagId) => void
  /** Overlay layer (e.g. COIN / BOMB FX) — same coordinate space as bags. */
  children?: ReactNode
}

export function BagBoard({
  bagCount,
  hiddenBagIds,
  onBagTap,
  children,
}: BagBoardProps) {
  const slots = getFormation(bagCount)
  // Soft gate: hide bag pixels until decode prep settles or a short timeout.
  // Does not block layout; OPEN/FX overlays still mount in the same board.
  const [imagesReady, setImagesReady] = useState(false)

  useEffect(() => {
    let active = true
    const show = () => {
      if (active) setImagesReady(true)
    }
    const timer = window.setTimeout(show, BAG_IMAGE_PREP_TIMEOUT_MS)
    void prepareBagImages().finally(() => {
      window.clearTimeout(timer)
      show()
    })
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div
      className={
        imagesReady ? 'bag-board' : 'bag-board bag-board--preparing'
      }
      data-bag-count={bagCount}
      aria-label={`${bagCount} bags`}
      aria-busy={imagesReady ? undefined : true}
    >
      {slots.map((slot) => {
        if (hiddenBagIds?.has(slot.bagId)) {
          return null
        }

        return (
          <div
            key={slot.bagId}
            className="bag-slot"
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              // Front (larger y) paints above back — shared with BOMB depth.
              zIndex: bagSlotDepthZIndex(slot.y),
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
        )
      })}
      {children}
    </div>
  )
}
