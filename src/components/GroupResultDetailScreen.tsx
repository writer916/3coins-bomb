import type { AppStrings } from '../i18n'
import type { GroupResultDetail } from '../group/groupPlayClient'
import {
  formatGroupHitRate,
  formatGroupRoundEndReason,
} from '../group/groupResultPresentation'
import { withDuelNums } from '../ui/withDuelNums'
import { DuelMatchDetailBoard } from './DuelMatchDetailBoard'

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
      aria-label={t.groupParticipantDetails}
      data-group-result-detail=""
    >
      <p
        className={`group-result-detail__nickname${detail.isSelf ? ' group-result-detail__nickname--self' : ''}`}
      >
        {detail.nickname}
      </p>
      <div className="group-result-detail__summary">
        <p>
          <span>{withDuelNums(t.groupTotalCoins)}</span>
          <strong>
            <span className="duel-num">{detail.totalCoins}</span>
          </strong>
        </p>
        <p>
          <span>{withDuelNums(t.groupThreeCoinsComplete)}</span>
          <strong>
            <span className="duel-num">{detail.threeCoinsComplete}</span>
          </strong>
        </p>
        <p>
          <span>{t.groupCoinBagHitRate}</span>
          <strong>
            {withDuelNums(formatGroupHitRate(detail.coinBagHits, detail.totalOpens))}
          </strong>
        </p>
      </div>
      <ol className="group-result-detail__rounds">
        {detail.rounds.map((round) => (
          <li
            key={round.roundNumber}
            className="group-result-detail__round"
            data-group-result-round={round.roundNumber}
          >
            <div className="group-result-detail__round-head match-detail-round__head">
              <p className="group-result-detail__round-label match-detail-round__label">
                {withDuelNums(`${t.groupRoundLabel} ${round.roundNumber}`)}
              </p>
              <p className="group-result-detail__round-end match-detail-round__end">
                {withDuelNums(formatGroupRoundEndReason(round.endReason, t))}
              </p>
            </div>
            <div className="group-result-detail__round-stats match-detail-round__stats">
              <p>
                <span>{t.detailCapturedCoins}</span>
                <strong>
                  <span className="duel-num">{round.capturedCoins}</span>
                </strong>
              </p>
              <p>
                <span>{t.detailOpenedBags}</span>
                <strong>
                  <span className="duel-num">{round.openedBagCount}</span>
                </strong>
              </p>
            </div>
            <DuelMatchDetailBoard
              bagCount={round.bagCount}
              bombBagNumber={round.bombBagNumber}
              coinBagNumbers={round.coinBagNumbers}
              opens={round.opens.map((opened) => ({
                openOrder: opened.order,
                bagNumber: opened.bagNumber,
              }))}
            />
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
