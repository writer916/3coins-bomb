import { useEffect, useMemo, useRef, useState } from 'react'
import { coinSrc, type BagId } from '../game/assets'
import { playCoinChime } from '../game/coinAudio'
import {
  planCoinFx,
  sampleCoinFx,
  sampleCoinSprites,
  type CoinFxSample,
  type CoinFxSpriteSample,
  type FxCoinCount,
} from '../game/coinFx'
import {
  claimOpenFxCompletion,
  openFxFallbackDelayMs,
} from '../game/openFxCompletion'
import { resolveCoinChimeRequest } from '../game/coinSfx'
import { playThreeCoins } from '../game/threeCoinsAudio'
import {
  resolveThreeCoinsSeRequest,
  shouldConsumeThreeCoinsCue,
  threeCoinsCueAtMs,
} from '../game/threeCoinsSfx'
import { getFormation, type BagCount } from '../game/formations'
import './CoinOpenFx.css'

type CoinOpenFxProps = {
  bagId: BagId
  bagCount: BagCount
  coinCount: FxCoinCount
  /**
   * True when this open caused ROUND cleared (provisional reached 3).
   * Gates 3 COINS confirm SE only — ROUND already settled in game logic.
   */
  clearsRound: boolean
  /** Current SOUND ON/OFF — gates chimes without touching ROUND. */
  soundEnabled: boolean
  onSample?: (sample: CoinFxSample) => void
  onComplete: () => void
}

type CoinFxFrame = {
  readonly sample: CoinFxSample
  readonly sprites: readonly CoinFxSpriteSample[]
}

function risePxFromMotion(motionT: number): number {
  return 28 + motionT * 18
}

function opacityFromMotion(motionT: number): number {
  return Math.min(1, 0.35 + motionT * 0.85)
}

/**
 * Local COIN burst above the opened bag. Visual only — does not mutate ROUND.
 * Remount via `key` when a new open starts.
 * Chimes fire when +N advances; optional 3 COINS SE after last chime + delay.
 *
 * coinCount 1: legacy single-sprite path (unchanged motion).
 * coinCount 2|3: overlapping sprites, same plan.totalMs / totalAtMs / chimes.
 */
export function CoinOpenFx({
  bagId,
  bagCount,
  coinCount,
  clearsRound,
  soundEnabled,
  onSample,
  onComplete,
}: CoinOpenFxProps) {
  const plan = useMemo(() => planCoinFx(bagId, coinCount), [bagId, coinCount])
  const threeCueAt = useMemo(
    () => (clearsRound ? threeCoinsCueAtMs(plan) : null),
    [clearsRound, plan],
  )
  const [frame, setFrame] = useState<CoinFxFrame>(() => ({
    sample: sampleCoinFx(plan, 0),
    sprites: coinCount === 1 ? [] : sampleCoinSprites(plan, 0),
  }))
  const completedRef = useRef(false)
  const prevDisplayRef = useRef<number | null>(null)
  const threeFiredRef = useRef(false)
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
  const sample = frame.sample

  useEffect(() => {
    completedRef.current = false
    prevDisplayRef.current = null
    threeFiredRef.current = false
    const started = performance.now()
    const rafRef = { id: 0 }
    let fallbackTimer = 0
    let cancelled = false
    const multi = plan.coinCount > 1

    const publish = (next: CoinFxSample, elapsed: number) => {
      setFrame({
        sample: next,
        sprites: multi ? sampleCoinSprites(plan, elapsed) : [],
      })
      onSampleRef.current?.(next)
    }

    const completeOnce = (elapsedForSample: number) => {
      if (cancelled || !claimOpenFxCompletion(completedRef)) return
      const final = sampleCoinFx(plan, Math.max(elapsedForSample, plan.totalMs))
      publish(final, plan.totalMs)
      onCompleteRef.current()
    }

    const tick = (now: number) => {
      if (cancelled || completedRef.current) return
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

      if (threeCueAt !== null) {
        const three = resolveThreeCoinsSeRequest(
          clearsRound,
          soundEnabledRef.current,
          threeFiredRef.current,
          elapsed,
          threeCueAt,
        )
        if (
          shouldConsumeThreeCoinsCue(
            clearsRound,
            threeFiredRef.current,
            elapsed,
            threeCueAt,
          )
        ) {
          threeFiredRef.current = true
        }
        if (three.play) {
          playThreeCoins({ soundEnabled: true })
        }
      }

      publish(next, elapsed)
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
  }, [plan, clearsRound, threeCueAt])

  if (!slot || sample.finished) return null

  const label = sample.displayTotal !== null ? `+${sample.displayTotal}` : ''
  const labelClass = sample.emphasize
    ? 'coin-open-fx-label coin-open-fx-label--strong'
    : 'coin-open-fx-label'

  // --- 1 COIN: legacy single-sprite structure (motion unchanged) ---
  if (plan.coinCount === 1) {
    const risePx = risePxFromMotion(sample.motionT)
    const opacity = opacityFromMotion(sample.motionT)
    return (
      <div
        className="coin-open-fx"
        data-bag-id={bagId}
        data-coin-sprites="1"
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
            <span className={labelClass}>
              <span className="duel-num">{label}</span>
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  // --- 2|3 COINS: overlapping sprites; label uses aggregate sample.motionT ---
  const labelRisePx = risePxFromMotion(sample.motionT)
  const labelOpacity = opacityFromMotion(sample.motionT)

  return (
    <div
      className="coin-open-fx"
      data-bag-id={bagId}
      data-coin-sprites={String(plan.coinCount)}
      style={{
        left: `${slot.x}%`,
        top: `${slot.y}%`,
        zIndex: Math.round(slot.y) + 40,
      }}
      aria-hidden="true"
    >
      {frame.sprites.map((sprite) => {
        if (!sprite.visible) return null
        const risePx = risePxFromMotion(sprite.motionT)
        const opacity = opacityFromMotion(sprite.motionT)
        return (
          <div
            key={sprite.index}
            className="coin-open-fx-sprite"
            data-sprite-index={sprite.index}
            style={{
              transform: `translate(calc(-50% + ${sprite.offsetXPx}px), calc(-50% - ${risePx}px + ${sprite.offsetYPx}px))`,
              opacity,
            }}
          >
            <img
              className="coin-open-fx-img"
              src={coinSrc(sprite.spinFrame)}
              alt=""
              draggable={false}
            />
          </div>
        )
      })}
      {label ? (
        <div
          className="coin-open-fx-label-layer"
          style={{
            transform: `translate(-50%, calc(-50% - ${labelRisePx}px))`,
            opacity: labelOpacity,
          }}
        >
          <span className={labelClass}>
            <span className="duel-num">{label}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
