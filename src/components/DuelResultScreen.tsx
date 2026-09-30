import type { DuelFinalResult, DuelResultParticipantSummary } from '../duel/duelPlayClient'
import type { AppStrings } from '../i18n'

type DuelResultScreenProps = {
  readonly result: DuelFinalResult
  readonly pending: boolean
  readonly error: boolean
  readonly onCheck: () => void
  readonly t: AppStrings
}

function hitRate(summary: DuelResultParticipantSummary): string {
  const percentage = (summary.hitRate.numerator / summary.hitRate.denominator) * 100
  const formatted = Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)
  return `${summary.hitRate.numerator} / ${summary.hitRate.denominator} (${formatted}%)`
}

export function DuelResultScreen({ result, pending, error, onCheck, t }: DuelResultScreenProps) {
  if (result.status === 'waiting') {
    return (
      <section className="duel-final duel-final--waiting" aria-live="polite">
        <p className="duel-final-kicker">{t.duelWaitingTitle}</p>
        <p className="duel-final-copy">{t.duelWaitingBody}</p>
        <button
          type="button"
          className="dev-btn"
          onClick={onCheck}
          disabled={pending}
        >
          {t.duelCheckResult}
        </button>
        {error ? <p className="duel-play-error" role="alert">{t.duelResultError}</p> : null}
      </section>
    )
  }

  const self = result.participants[result.viewerRole]
  const opponentRole = result.viewerRole === 'A' ? 'B' : 'A'
  const opponent = result.participants[opponentRole]
  const verdict = result.winner === 'draw'
    ? t.duelDraw
    : result.winner === result.viewerRole ? t.duelWin : t.duelLose

  return (
    <section className="duel-final duel-final--completed">
      <p className="duel-final-kicker">{t.duelResult}</p>
      <h2 className="duel-final-verdict">{verdict}</h2>
      <div className="duel-final-scores">
        <div className="duel-final-player">
          <h3>{t.duelYou}</h3>
          <p><span>{t.duelTotalCoins}</span><strong>{self.totalCapturedCoins}</strong></p>
          <p><span>{t.duelCoinBagHitRate}</span><strong>{hitRate(self)}</strong></p>
        </div>
        <div className="duel-final-player">
          <h3>{t.duelOpponent}</h3>
          <p><span>{t.duelTotalCoins}</span><strong>{opponent.totalCapturedCoins}</strong></p>
          <p><span>{t.duelCoinBagHitRate}</span><strong>{hitRate(opponent)}</strong></p>
        </div>
      </div>
    </section>
  )
}
