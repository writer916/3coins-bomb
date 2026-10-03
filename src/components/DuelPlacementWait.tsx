import type { AppStrings } from '../i18n'

export type DuelPlacementWaitProps = {
  readonly t: AppStrings
  readonly onGoTop?: () => void
}

/**
 * Self locked / opponent unlocked: single status + bottom secondary TOP.
 * Joined vs not-joined is not distinguished in the UI.
 */
export function DuelPlacementWait({ t, onGoTop }: DuelPlacementWaitProps) {
  return (
    <div className="duel-flow duel-flow--placement-wait" role="status">
      <div className="duel-status-slot" aria-hidden="true" />
      <p className="duel-placement-wait__status">
        {t.duelWaitingForOpponentPlacement}
      </p>
      {onGoTop ? (
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top duel-placement-wait__top"
          onClick={onGoTop}
        >
          {t.duelReturnToTop}
        </button>
      ) : (
        <span
          className="duel-btn duel-btn--quiet-top duel-placement-wait__top-slot"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
