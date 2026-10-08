import type {
  DuelMatchDetailRoundView,
  DuelMatchDetailView,
} from '../duel/duelMatchDetailPresentation'
import type { AppStrings } from '../i18n'
import { withDuelNums } from '../ui/withDuelNums'
import { DuelMatchDetailBoard } from './DuelMatchDetailBoard'

type DuelMatchDetailScreenProps = {
  readonly detail: DuelMatchDetailView
  readonly t: AppStrings
  readonly onBackToResult: () => void
}

function DetailRoundBlock({
  round,
  label,
  t,
}: {
  readonly round: DuelMatchDetailRoundView
  readonly label: string
  readonly t: AppStrings
}) {
  const endReason = round.endReason === 'bombed'
    ? t.groupRoundBombed
    : round.endReason === 'cashed_out'
      ? t.groupRoundCashedOut
      : t.duelThreeCoinsComplete
  return (
    <div
      className="duel-match-detail__round"
      data-duel-match-detail-round={round.roundNumber}
    >
      <div className="match-detail-round__head">
        <p className="duel-match-detail__round-label match-detail-round__label">
          {withDuelNums(label)}
        </p>
        <p className="match-detail-round__end">{withDuelNums(endReason)}</p>
      </div>
      <div className="match-detail-round__stats">
        <p>
          <span>{t.detailCapturedCoins}</span>
          <strong>{round.capturedCoins}</strong>
        </p>
        <p>
          <span>{t.detailOpenedBags}</span>
          <strong>{round.openedBagCount}</strong>
        </p>
      </div>
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
        {detail.yourRounds.map((round) => (
          <DetailRoundBlock
            key={`you-${round.roundNumber}`}
            round={round}
            label={t.duelMatchDetailRound(round.roundNumber)}
            t={t}
          />
        ))}
      </section>

      <section
        className="duel-match-detail__side duel-match-detail__side--opponent"
        data-duel-match-detail-side="opponent"
      >
        <h2 className="duel-match-detail__side-title">{t.duelOpponent}</h2>
        {detail.opponentRounds.map((round) => (
          <DetailRoundBlock
            key={`opponent-${round.roundNumber}`}
            round={round}
            label={t.duelMatchDetailRound(round.roundNumber)}
            t={t}
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
