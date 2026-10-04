import type { DuelMatchDetail, DuelMatchDetailRound } from '../duel/duelPlayClient'
import type { AppStrings } from '../i18n'
import { DuelMatchDetailBoard } from './DuelMatchDetailBoard'

type DuelMatchDetailScreenProps = {
  readonly detail: DuelMatchDetail
  readonly t: AppStrings
  readonly onBackToResult: () => void
}

function DetailRoundBlock({
  round,
  label,
}: {
  readonly round: DuelMatchDetailRound
  readonly label: string
}) {
  return (
    <div
      className="duel-match-detail__round"
      data-duel-match-detail-round={round.roundNumber}
    >
      <p className="duel-match-detail__round-label">{label}</p>
      <DuelMatchDetailBoard
        bagCount={round.bagCount}
        bombBagNumber={round.bombBagNumber}
        coinBagNumbers={round.coinBagNumbers}
        opens={round.opens}
      />
    </div>
  )
}

/**
 * Completed-match detail: yourPlay then opponentPlay, all ROUNDS vertical.
 * Read-only boards; back returns to the same final RESULT summary.
 */
export function DuelMatchDetailScreen({
  detail,
  t,
  onBackToResult,
}: DuelMatchDetailScreenProps) {
  return (
    <section
      className="duel-match-detail"
      data-duel-match-detail=""
      aria-label={t.duelMatchDetails}
    >
      <p className="duel-match-detail__title">{t.duelMatchDetails}</p>

      <section
        className="duel-match-detail__side"
        data-duel-match-detail-side="you"
      >
        <h2 className="duel-match-detail__side-title">{t.duelYou}</h2>
        {detail.yourPlay.rounds.map((round) => (
          <DetailRoundBlock
            key={`you-${round.roundNumber}`}
            round={round}
            label={t.duelMatchDetailRound(round.roundNumber)}
          />
        ))}
      </section>

      <section
        className="duel-match-detail__side duel-match-detail__side--opponent"
        data-duel-match-detail-side="opponent"
      >
        <h2 className="duel-match-detail__side-title">{t.duelOpponent}</h2>
        {detail.opponentPlay.rounds.map((round) => (
          <DetailRoundBlock
            key={`opponent-${round.roundNumber}`}
            round={round}
            label={t.duelMatchDetailRound(round.roundNumber)}
          />
        ))}
      </section>

      <div className="duel-match-detail__actions">
        <button
          type="button"
          className="duel-btn duel-btn--quiet-top duel-match-detail__back"
          data-duel-metric="secondary"
          onClick={onBackToResult}
        >
          {t.duelBackToResult}
        </button>
      </div>
    </section>
  )
}
