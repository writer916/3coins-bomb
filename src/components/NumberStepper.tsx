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

/**
 * Compact vertical ▲/▼ stepper (dokodesho clamp + tap size; 3CB visual family).
 * Layout: [ value | ▲▼ ] — not a horizontal chip row of all options.
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
            onClick={() => onChange(Math.min(max, value + 1))}
          >
            ▲
          </button>
          <button
            type="button"
            className="num-stepper-btn"
            aria-label={`${label} −1`}
            disabled={disabled || atMin}
            onClick={() => onChange(Math.max(min, value - 1))}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  )
}
