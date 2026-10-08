import type { AppStrings } from '../i18n'
import { withDuelNums } from '../ui/withDuelNums'

/**
 * Pre-PLAY gate modeled on DuelStartConfirm.
 * Preparing and ready are mutually exclusive; PLAY starts only on tap.
 */
export function GroupReadyScreen({
  nickname,
  totalRounds,
  playerLimit,
  canStart,
  t,
  onStart,
  onGoTop,
}: {
  readonly nickname: string | null
  readonly totalRounds: number | null
  readonly playerLimit: number | null
  readonly canStart: boolean
  readonly t: AppStrings
  readonly onStart: () => void
  readonly onGoTop: () => void
}) {
  return (
    <div className="duel-flow duel-flow--start-confirm group-entry-ready">
      <div className="duel-start-confirm" role="status" aria-live="polite">
        {canStart ? (
          <>
            <p className="duel-start-confirm__ready">{t.groupPlayReady}</p>
            <ul className="duel-start-confirm__list">
              <li>
                <span className="duel-start-confirm__label">
                  {t.groupReadyRoundsLabel}
                </span>
                <span className="duel-start-confirm__value">
                  {totalRounds !== null ? withDuelNums(String(totalRounds)) : '\u00a0'}
                </span>
              </li>
              <li>
                <span className="duel-start-confirm__label">
                  {t.groupReadyPlayersLabel}
                </span>
                <span className="duel-start-confirm__value">
                  {playerLimit !== null ? withDuelNums(String(playerLimit)) : '\u00a0'}
                </span>
              </li>
              <li>
                <span className="duel-start-confirm__label">
                  {t.groupReadyNicknameLabel}
                </span>
                <span className="duel-start-confirm__value group-ready-nickname-value">
                  {nickname ?? '\u00a0'}
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
                {t.groupPlayStart}
              </button>
            </div>
          </>
        ) : (
          <p className="duel-start-confirm__ready group-ready-preparing">
            {t.groupPlayPreparing}
          </p>
        )}
      </div>
      <button
        type="button"
        className="duel-btn duel-btn--quiet-top duel-start-confirm__top"
        data-duel-metric="secondary"
        onClick={onGoTop}
      >
        {t.duelReturnToTop}
      </button>
    </div>
  )
}
