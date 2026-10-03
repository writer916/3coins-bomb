import type { AppStrings } from '../i18n'
import { withDuelNums } from '../ui/withDuelNums'

export type DuelStartConfirmProps = {
  readonly createdAt: string
  readonly totalRounds: number
  readonly t: AppStrings
  readonly onStart: () => void
  readonly onGoTop?: () => void
}

/**
 * Post–both-LOCK start gate (A/B shared). START is client-session only;
 * does not call a start API or wait for the opponent.
 */
export function DuelStartConfirm({
  createdAt,
  totalRounds,
  t,
  onStart,
  onGoTop,
}: DuelStartConfirmProps) {
  const createdLabel = t.duelMatchCreatedAt(createdAt)

  return (
    <div className="duel-flow duel-flow--start-confirm">
      <div className="duel-start-confirm" role="status">
        <p className="duel-start-confirm__created">
          {createdLabel ? withDuelNums(createdLabel) : '\u00a0'}
        </p>
        <p className="duel-start-confirm__ready">{t.duelStartConfirmReady}</p>
        <ul className="duel-start-confirm__list">
          <li>
            <span className="duel-start-confirm__label">
              {t.duelStartConfirmRoundsLabel}
            </span>
            <span className="duel-start-confirm__value">
              {withDuelNums(t.duelStartConfirmRoundsValue(totalRounds))}
            </span>
          </li>
        </ul>
        <div className="duel-start-confirm__actions">
          <button
            type="button"
            className="duel-btn duel-btn--primary duel-start-confirm__start"
            data-duel-metric="primary"
            onClick={onStart}
          >
            {t.duelStartConfirmStart}
          </button>
          {onGoTop ? (
            <button
              type="button"
              className="duel-btn duel-start-confirm__top"
              data-duel-metric="secondary"
              onClick={onGoTop}
            >
              {t.duelReturnToTop}
            </button>
          ) : (
            <span className="duel-start-confirm__top-slot" aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  )
}
