import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { withDuelNums } from '../ui/withDuelNums'

type NumberStepperProps = {
  label: string
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  /** Accessible name for the value. */
  valueAriaLabel?: string
  disabled?: boolean
  /** When false, label text is omitted (height reserved by parent slot). */
  showLabel?: boolean
}

const HOLD_DELAY_MS = 400
const REPEAT_START_MS = 130
const REPEAT_MIN_MS = 40
const REPEAT_ACCEL = 0.82

/**
 * Compact vertical ▲/▼ stepper (dokodesho clamp + tap size; 3CB visual family).
 * Layout: [ value | ▲▼ ] — not a horizontal chip row of all options.
 * Pointer hold (~400ms) repeats with mild acceleration; keyboard stays 1-step.
 */
export function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
  valueAriaLabel,
  disabled = false,
  showLabel = true,
}: NumberStepperProps) {
  const atMin = value <= min
  const atMax = value >= max

  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const minRef = useRef(min)
  const maxRef = useRef(max)
  const disabledRef = useRef(disabled)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClickRef = useRef(false)
  const activeDeltaRef = useRef<0 | 1 | -1>(0)
  const activePointerIdRef = useRef<number | null>(null)

  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (repeatTimerRef.current !== null) {
      clearTimeout(repeatTimerRef.current)
      repeatTimerRef.current = null
    }
    activeDeltaRef.current = 0
    activePointerIdRef.current = null
  }

  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
    minRef.current = min
    maxRef.current = max
    disabledRef.current = disabled
  }, [value, onChange, min, max, disabled])

  useEffect(() => {
    const stop = () => {
      clearHold()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const applyStep = (delta: 1 | -1): boolean => {
    if (disabledRef.current) return false
    const current = valueRef.current
    const next = Math.min(
      maxRef.current,
      Math.max(minRef.current, current + delta),
    )
    if (next === current) return false
    onChangeRef.current(next)
    return true
  }

  const scheduleRepeat = (delta: 1 | -1, delayMs: number) => {
    repeatTimerRef.current = setTimeout(() => {
      if (activeDeltaRef.current !== delta) return
      if (!applyStep(delta)) {
        clearHold()
        return
      }
      const nextDelay = Math.max(REPEAT_MIN_MS, Math.round(delayMs * REPEAT_ACCEL))
      scheduleRepeat(delta, nextDelay)
    }, delayMs)
  }

  const pointerInside = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): boolean => {
    const rect = event.currentTarget.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  }

  const onPointerDown = (delta: 1 | -1) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    // Ignore non-primary mouse buttons; allow 0 and unset (-1) for synthetics.
    if (event.pointerType === 'mouse' && event.button > 0) return
    suppressClickRef.current = false
    clearHold()
    activeDeltaRef.current = delta
    activePointerIdRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Some environments reject capture on synthetic pointers. */
    }
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      if (activeDeltaRef.current !== delta) return
      suppressClickRef.current = true
      if (!applyStep(delta)) {
        clearHold()
        return
      }
      scheduleRepeat(delta, REPEAT_START_MS)
    }, HOLD_DELAY_MS)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return
    if (!pointerInside(event)) {
      clearHold()
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        /* ignore */
      }
    }
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      activePointerIdRef.current !== null &&
      event.pointerId !== activePointerIdRef.current
    ) {
      return
    }
    clearHold()
  }

  const onClickStep = (delta: 1 | -1) => () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    applyStep(delta)
  }

  return (
    <div className="num-stepper" role="group" aria-label={label}>
      {showLabel ? (
        <p className="num-stepper-label" data-duel-metric="label">
          {withDuelNums(label)}
        </p>
      ) : null}
      <div className="num-stepper-body">
        <p
          className="num-stepper-value duel-num"
          aria-live="polite"
          aria-label={valueAriaLabel}
        >
          {value}
        </p>
        <div className="num-stepper-buttons">
          <button
            type="button"
            className="num-stepper-btn"
            aria-label={`${label} +1`}
            disabled={disabled || atMax}
            onClick={onClickStep(1)}
            onPointerDown={onPointerDown(1)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
          >
            ▲
          </button>
          <button
            type="button"
            className="num-stepper-btn"
            aria-label={`${label} −1`}
            disabled={disabled || atMin}
            onClick={onClickStep(-1)}
            onPointerDown={onPointerDown(-1)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  )
}
