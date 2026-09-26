import { useEffect, useMemo, useRef, useState } from 'react'
import type { BagId } from '../game/assets'
import { planEmptyFx, sampleEmptyFx, type EmptyFxSample } from '../game/emptyFx'
import { resolveEmptyPlacement } from '../game/emptyPlacement'
import { bagDepthZIndex, type BagCount } from '../game/formations'
import './EmptyOpenFx.css'

type EmptyOpenFxProps = {
  bagId: BagId
  bagCount: BagCount
  onSample?: (sample: EmptyFxSample) => void
  onComplete: () => void
}

/**
 * Quiet EMPTY label at the opened bag’s visual center.
 * Visual only; ROUND stays active via game logic. Silent.
 */
export function EmptyOpenFx({
  bagId,
  bagCount,
  onSample,
  onComplete,
}: EmptyOpenFxProps) {
  const plan = useMemo(() => planEmptyFx(bagId), [bagId])
  const [sample, setSample] = useState<EmptyFxSample>(() => sampleEmptyFx(plan, 0))
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const onSampleRef = useRef(onSample)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onSampleRef.current = onSample
  }, [onComplete, onSample])

  const placement = useMemo(
    () => resolveEmptyPlacement({ bagId, bagCount }),
    [bagId, bagCount],
  )

  const depthZ = useMemo(
    () => bagDepthZIndex(bagCount, bagId),
    [bagCount, bagId],
  )

  useEffect(() => {
    completedRef.current = false
    const started = performance.now()
    let raf = 0

    const tick = (now: number) => {
      const elapsed = now - started
      const next = sampleEmptyFx(plan, elapsed)
      setSample(next)
      onSampleRef.current?.(next)
      if (next.finished) {
        if (!completedRef.current) {
          completedRef.current = true
          onCompleteRef.current()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [plan])

  if (sample.finished) return null

  const ox = `calc(var(--bag-size) * ${placement.offsetXBag})`
  const oy = `calc(var(--bag-size) * ${placement.offsetYBag})`

  return (
    <p
      className="empty-open-fx"
      data-bag-id={bagId}
      style={{
        left: `${placement.slotX}%`,
        top: `${placement.slotY}%`,
        zIndex: depthZ,
        ['--empty-ox' as string]: ox,
        ['--empty-oy' as string]: oy,
        opacity: sample.opacity,
      }}
      aria-hidden="true"
    >
      EMPTY
    </p>
  )
}
