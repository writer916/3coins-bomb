import type { AppStrings } from '../i18n'
import type { GroupResult } from '../group/groupPlayClient'
import { formatGroupHitRate } from '../group/groupResultPresentation'
import { withDuelNums } from '../ui/withDuelNums'

export function GroupResultScreen({result,t,onGoTop}:{result:GroupResult;t:AppStrings;onGoTop:()=>void}) {
  return <section className="group-result" aria-labelledby="group-result-title">
    <h2 id="group-result-title" className="group-result__title">{t.groupResultTitle}</h2>
    <ol className="group-result__ranking">
      {result.ranking.map((entry,index)=><li key={`${entry.rank}-${index}-${entry.nickname}`} className={`group-result__entry${entry.isSelf?' group-result__entry--self':''}`} aria-current={entry.isSelf?'true':undefined}>
        <div className="group-result__identity"><span className="group-result__rank" aria-label={`${t.groupRank} ${entry.rank}`}>{entry.rank}</span><span className="group-result__nickname">{entry.nickname}</span></div>
        <div className="group-result__stats">
          <p><span>{withDuelNums(t.groupTotalCoins)}</span><strong>{entry.totalCoins}</strong></p>
          <p><span>{withDuelNums(t.groupThreeCoinsComplete)}</span><strong>{entry.threeCoinsComplete}</strong></p>
          <p><span>{t.groupCoinBagHitRate}</span><strong>{formatGroupHitRate(entry.coinBagHits,entry.totalOpens)}</strong></p>
        </div>
      </li>)}
    </ol>
    <button type="button" className="duel-btn duel-btn--quiet-top group-result__top" onClick={onGoTop}>{t.duelReturnToTop}</button>
  </section>
}
