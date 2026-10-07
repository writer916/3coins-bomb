import type { AppStrings } from '../i18n'
import type { GroupResultDetail } from '../group/groupPlayClient'
import {
  formatGroupHitRate,
  formatGroupOpenReveal,
  formatGroupRoundEndReason,
} from '../group/groupResultPresentation'
import { withDuelNums } from '../ui/withDuelNums'

export function GroupResultDetailScreen({
  detail,
  t,
  onBackToResult,
}: {
  readonly detail: GroupResultDetail
  readonly t: AppStrings
  readonly onBackToResult: () => void
}) {
  return (
    <section
      className="group-result-detail"
      aria-labelledby="group-result-detail-title"
      data-group-result-detail=""
    >
      <h2 id="group-result-detail-title" className="group-result-detail__title">
        {t.groupParticipantDetails}
      </h2>
      <p
        className={`group-result-detail__nickname${detail.isSelf ? ' group-result-detail__nickname--self' : ''}`}
      >
        {detail.nickname}
      </p>
      <div className="group-result-detail__summary">
        <p>
          <span>{withDuelNums(t.groupTotalCoins)}</span>
          <strong>{detail.totalCoins}</strong>
        </p>
        <p>
          <span>{withDuelNums(t.groupThreeCoinsComplete)}</span>
          <strong>{detail.threeCoinsComplete}</strong>
        </p>
        <p>
          <span>{t.groupCoinBagHitRate}</span>
          <strong>{formatGroupHitRate(detail.coinBagHits, detail.totalOpens)}</strong>
        </p>
      </div>
      <ol className="group-result-detail__rounds">
        {detail.rounds.map((round) => (
          <li
            key={round.roundNumber}
            className="group-result-detail__round"
            data-group-result-round={round.roundNumber}
          >
            <div className="group-result-detail__round-head">
              <p className="group-result-detail__round-label">
                {withDuelNums(`${t.groupRoundLabel} ${round.roundNumber}`)}
              </p>
              <p className="group-result-detail__round-end">
                {formatGroupRoundEndReason(round.endReason, t)}
              </p>
            </div>
            <div className="group-result-detail__round-stats">
              <p>
                <span>{t.groupCapturedCoins}</span>
                <strong>{round.capturedCoins}</strong>
              </p>
              <p>
                <span>{t.groupOpenedBags}</span>
                <strong>{round.openedBagCount}</strong>
              </p>
            </div>
            {round.opens.length > 0 ? (
              <ol className="group-result-detail__opens">
                {round.opens.map((opened) => (
                  <li key={opened.order}>
                    <span className="group-result-detail__open-order">
                      {withDuelNums(String(opened.order))}
                    </span>
                    <span className="group-result-detail__open-result">
                      {formatGroupOpenReveal(opened, t)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="duel-btn duel-btn--quiet-top group-result-detail__back"
        onClick={onBackToResult}
      >
        {t.groupBackToResult}
      </button>
    </section>
  )
}
