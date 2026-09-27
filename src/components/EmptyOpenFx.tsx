import { useEffect, useMemo, useRef, useState } from 'react'
import type { BagId } from '../game/assets'
import { planEmptyFx, sampleEmptyFx, type EmptyFxSample } from '../game/emptyFx'
import { resolveEmptyPlacement } from '../game/emptyPlacement'
import {
  claimOpenFxCompletion,
  openFxFallbackDelayMs,
} from '../game/openFxCompletion'
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
    const rafRef = { id: 0 }
    let fallbackTimer = 0
    let cancelled = false

    const completeOnce = (elapsedForSample: number) => {
      if (cancelled || !claimOpenFxCompletion(completedRef)) return
      const final = sampleEmptyFx(plan, Math.max(elapsedForSample, plan.totalMs))
      setSample(final)
      onSampleRef.current?.(final)
      onCompleteRef.current()
    }

    const tick = (now: number) => {
      if (cancelled || completedRef.current) return
      const elapsed = now - started
      const next = sampleEmptyFx(plan, elapsed)
      setSample(next)
      onSampleRef.current?.(next)
      if (next.finished) {
        window.clearTimeout(fallbackTimer)
        completeOnce(elapsed)
        return
      }
      rafRef.id = requestAnimationFrame(tick)
    }

    rafRef.id = requestAnimationFrame(tick)
    fallbackTimer = window.setTimeout(() => {
      if (cancelled || completedRef.current) return
      cancelAnimationFrame(rafRef.id)
      completeOnce(plan.totalMs)
    }, openFxFallbackDelayMs(plan.totalMs))

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.id)
      window.clearTimeout(fallbackTimer)
    }
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
