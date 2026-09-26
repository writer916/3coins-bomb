import { useEffect, useMemo, useRef, useState } from 'react'
import { coinSrc, type BagId } from '../game/assets'
import { playCoinChime } from '../game/coinAudio'
import {
  planCoinFx,
  sampleCoinFx,
  type CoinFxSample,
  type FxCoinCount,
} from '../game/coinFx'
import { resolveCoinChimeRequest } from '../game/coinSfx'
import { getFormation, type BagCount } from '../game/formations'
import './CoinOpenFx.css'

type CoinOpenFxProps = {
  bagId: BagId
  bagCount: BagCount
  coinCount: FxCoinCount
  /** Current SOUND ON/OFF — gates chimes without touching ROUND. */
  soundEnabled: boolean
  onSample?: (sample: CoinFxSample) => void
  onComplete: () => void
}

/**
 * Local COIN burst above the opened bag. Visual only — does not mutate ROUND.
 * Remount via `key` when a new open starts.
 * Chimes fire when +N advances; audio failures are swallowed.
 */
export function CoinOpenFx({
  bagId,
  bagCount,
  coinCount,
  soundEnabled,
  onSample,
  onComplete,
}: CoinOpenFxProps) {
  const plan = useMemo(() => planCoinFx(bagId, coinCount), [bagId, coinCount])
  const [sample, setSample] = useState<CoinFxSample>(() => sampleCoinFx(plan, 0))
  const completedRef = useRef(false)
  const prevDisplayRef = useRef<number | null>(null)
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

  const slot = getFormation(bagCount).find((s) => s.bagId === bagId)

  useEffect(() => {
    completedRef.current = false
    prevDisplayRef.current = null
    const started = performance.now()
    let raf = 0

    const tick = (now: number) => {
      const elapsed = now - started
      const next = sampleCoinFx(plan, elapsed)

      const chime = resolveCoinChimeRequest(
        soundEnabledRef.current,
        prevDisplayRef.current,
        next.displayTotal,
      )
      if (chime.play) {
        playCoinChime({ soundEnabled: true })
      }
      if (next.displayTotal !== prevDisplayRef.current) {
        prevDisplayRef.current = next.displayTotal
      }

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

  if (!slot || sample.finished) return null

  const risePx = 28 + sample.motionT * 18
  const opacity = Math.min(1, 0.35 + sample.motionT * 0.85)
  const label = sample.displayTotal !== null ? `+${sample.displayTotal}` : ''

  return (
    <div
      className="coin-open-fx"
      data-bag-id={bagId}
      style={{
        left: `${slot.x}%`,
        top: `${slot.y}%`,
        zIndex: Math.round(slot.y) + 40,
      }}
      aria-hidden="true"
    >
      <div
        className="coin-open-fx-inner"
        style={{
          transform: `translate(-50%, calc(-50% - ${risePx}px))`,
          opacity,
        }}
      >
        <img
          className="coin-open-fx-img"
          src={coinSrc(sample.spinFrame)}
          alt=""
          draggable={false}
        />
        {label ? (
          <span
            className={
              sample.emphasize
                ? 'coin-open-fx-label coin-open-fx-label--strong'
                : 'coin-open-fx-label'
            }
          >
            {label}
          </span>
        ) : null}
      </div>
    </div>
  )
}
