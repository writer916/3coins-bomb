import { useEffect, useMemo, useRef, useState } from 'react'
import { bombSrc, type BagId } from '../game/assets'
import { playBombPop, warmBombAudio } from '../game/bombAudio'
import { planBombFx, sampleBombFx, type BombFxSample } from '../game/bombFx'
import { BOMB_SIZE_FRAC_OF_BAG, resolveBombPlacement } from '../game/bombPlacement'
import {
  bombSoundCueFromPlan,
  resolveBombPopRequest,
  shouldConsumeBombPopCue,
} from '../game/bombSfx'
import {
  claimOpenFxCompletion,
  openFxFallbackDelayMs,
} from '../game/openFxCompletion'
import { bagDepthZIndex, type BagCount } from '../game/formations'
import './BombOpenFx.css'

type BombOpenFxProps = {
  bagId: BagId
  bagCount: BagCount
  /** Opened / hidden bags — neighbors for collision are the rest. */
  hiddenBagIds: ReadonlySet<BagId>
  /** Current SOUND ON/OFF — gates pop without touching ROUND. */
  soundEnabled: boolean
  onSample?: (sample: BombFxSample) => void
  onComplete: () => void
}

/**
 * BOMB reveal at the opened bag’s visual center — no upward flight.
 * Visual only for ROUND (already bombed); optional fade-start pop SE.
 */
export function BombOpenFx({
  bagId,
  bagCount,
  hiddenBagIds,
  soundEnabled,
  onSample,
  onComplete,
}: BombOpenFxProps) {
  const plan = useMemo(() => planBombFx(bagId), [bagId])
  const cue = useMemo(() => bombSoundCueFromPlan(plan), [plan])
  const [sample, setSample] = useState<BombFxSample>(() => sampleBombFx(plan, 0))
  const completedRef = useRef(false)
  const popFiredRef = useRef(false)
  const soundEnabledRef = useRef(soundEnabled)
  const onCompleteRef = useRef(onComplete)
  const onSampleRef = useRef(onSample)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onSampleRef.current = onSample
  }, [onComplete, onSample])

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
  }, [soundEnabled])

  useEffect(() => {
    warmBombAudio()
  }, [])

  const remainingBagIds = useMemo(() => {
    const all: BagId[] = []
    for (let i = 1; i <= bagCount; i++) {
      const id = `bag-${i}` as BagId
      if (!hiddenBagIds.has(id)) all.push(id)
    }
    return all
  }, [bagCount, hiddenBagIds])

  const placement = useMemo(
    () =>
      resolveBombPlacement({
        bagId,
        bagCount,
        remainingBagIds,
      }),
    [bagId, bagCount, remainingBagIds],
  )

  const depthZ = useMemo(
    () => bagDepthZIndex(bagCount, bagId),
    [bagCount, bagId],
  )

  useEffect(() => {
    completedRef.current = false
    popFiredRef.current = false
    const started = performance.now()
    const rafRef = { id: 0 }
    let fallbackTimer = 0
    let cancelled = false

    const completeOnce = (elapsedForSample: number) => {
      if (cancelled || !claimOpenFxCompletion(completedRef)) return
      const final = sampleBombFx(plan, Math.max(elapsedForSample, plan.totalMs))
      setSample(final)
      onSampleRef.current?.(final)
      onCompleteRef.current()
    }

    const tick = (now: number) => {
      if (cancelled || completedRef.current) return
      const elapsed = now - started
      const next = sampleBombFx(plan, elapsed)

      const pop = resolveBombPopRequest(
        soundEnabledRef.current,
        popFiredRef.current,
        elapsed,
        cue.atMs,
      )
      if (shouldConsumeBombPopCue(popFiredRef.current, elapsed, cue.atMs)) {
        popFiredRef.current = true
      }
      if (pop.play) {
        playBombPop({ soundEnabled: true })
      }

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
  }, [plan, cue.atMs])

  if (sample.finished) return null

  const ox = `calc(var(--bag-size) * ${placement.offsetXBag})`
  const oy = `calc(var(--bag-size) * ${placement.offsetYBag})`

  return (
    <div
      className={
        sample.shaking ? 'bomb-open-fx bomb-open-fx--shake' : 'bomb-open-fx'
      }
      data-bag-id={bagId}
      style={{
        left: `${placement.slotX}%`,
        top: `${placement.slotY}%`,
        // Inherit opened bag depth — never boost above front-row bags.
        zIndex: depthZ,
        width: `calc(var(--bag-size) * ${BOMB_SIZE_FRAC_OF_BAG})`,
        ['--bomb-ox' as string]: ox,
        ['--bomb-oy' as string]: oy,
        opacity: sample.opacity,
      }}
      aria-hidden="true"
    >
      <img
        className="bomb-open-fx-img"
        src={bombSrc(sample.frame)}
        alt=""
        draggable={false}
      />
    </div>
  )
}
