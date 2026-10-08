import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppStrings } from '../i18n'
import type { GroupResult, GroupResultDetail } from '../group/groupPlayClient'
import { formatGroupHitRate } from '../group/groupResultPresentation'
import { BrandTitle } from '../ui/BrandTitle'
import { withDuelNums } from '../ui/withDuelNums'
import { GroupResultDetailScreen } from './GroupResultDetailScreen'

type DetailPane =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly entryKey: string }
  | { readonly kind: 'ready'; readonly detail: GroupResultDetail }

export function GroupResultScreen({
  result,
  t,
  onGoTop,
  fetchDetail,
}: {
  readonly result: GroupResult
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly fetchDetail: (entryKey: string) => Promise<GroupResultDetail>
}) {
  const [detailPane, setDetailPane] = useState<DetailPane>({ kind: 'closed' })
  const [detailBusy, setDetailBusy] = useState(false)
  const inFlightRef = useRef(false)
  const cacheRef = useRef<Map<string, GroupResultDetail>>(new Map())
  const fetchDetailRef = useRef(fetchDetail)
  useEffect(() => {
    fetchDetailRef.current = fetchDetail
  }, [fetchDetail])

  const loadDetail = useCallback(async (entryKey: string) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setDetailBusy(true)
    setDetailPane({ kind: 'loading' })
    try {
      const detail = await fetchDetailRef.current(entryKey)
      cacheRef.current.set(entryKey, detail)
      setDetailPane({ kind: 'ready', detail })
    } catch {
      setDetailPane({ kind: 'error', entryKey })
    } finally {
      inFlightRef.current = false
      setDetailBusy(false)
    }
  }, [])

  const openDetails = useCallback(
    (entryKey: string) => {
      if (inFlightRef.current) return
      const cached = cacheRef.current.get(entryKey)
      if (cached) {
        setDetailPane({ kind: 'ready', detail: cached })
        return
      }
      void loadDetail(entryKey)
    },
    [loadDetail],
  )

  const closeDetails = useCallback(() => {
    setDetailPane({ kind: 'closed' })
  }, [])

  if (detailPane.kind === 'loading') {
    return (
      <div className="group-result-detail-status" role="status">
        {t.groupDetailLoading}
      </div>
    )
  }

  if (detailPane.kind === 'error') {
    return (
      <section className="group-result-detail-error" role="alert">
        <p className="group-result-detail-error__copy stable-message-slot stable-message-slot--detail-error">
          {t.groupDetailError}
        </p>
        <div className="group-result-detail-error__actions">
          <button
            type="button"
            className="duel-btn"
            disabled={detailBusy}
            onClick={() => {
              void loadDetail(detailPane.entryKey)
            }}
          >
            {t.groupDetailRetry}
          </button>
          <button
            type="button"
            className="duel-btn duel-btn--quiet-top"
            onClick={closeDetails}
          >
            {t.groupBackToResult}
          </button>
        </div>
      </section>
    )
  }

  if (detailPane.kind === 'ready') {
    return (
      <GroupResultDetailScreen
        detail={detailPane.detail}
        t={t}
        onBackToResult={closeDetails}
      />
    )
  }

  return (
    <section className="group-result" aria-labelledby="group-result-title">
      <BrandTitle title={t.brandTitle} className="brand-title duel-final-brand" />
      <h2 id="group-result-title" className="group-result__title">
        {t.groupResultTitle}
      </h2>
      <div className="group-result__table">
        <div className="group-result__cols group-result__header" aria-hidden="true">
          <span className="group-result__h-rank" />
          <span className="group-result__h-nick" />
          <span className="group-result__h-metric">
            {withDuelNums(t.groupTotalCoins)}
          </span>
          <span className="group-result__h-metric">
            {withDuelNums(t.groupThreeCoinsComplete)}
          </span>
          <span className="group-result__h-metric">{t.groupCoinBagHitRate}</span>
          <span className="group-result__h-action" />
        </div>
        <ol className="group-result__ranking">
          {result.ranking.map((entry, index) => (
            <li
              key={entry.entryKey}
              className={`group-result__cols group-result__entry${entry.isSelf ? ' group-result__entry--self' : ''}`}
              aria-current={entry.isSelf ? 'true' : undefined}
            >
              <span
                className="group-result__rank"
                aria-label={`${t.groupRank} ${entry.rank}`}
              >
                <span className="duel-num">{entry.rank}</span>
              </span>
              <span className="group-result__nickname" title={entry.nickname}>
                {entry.nickname}
              </span>
              <strong
                className="group-result__metric"
                aria-label={`${t.groupTotalCoins} ${entry.totalCoins}`}
              >
                <span className="duel-num">{entry.totalCoins}</span>
              </strong>
              <strong
                className="group-result__metric"
                aria-label={`${t.groupThreeCoinsComplete} ${entry.threeCoinsComplete}`}
              >
                <span className="duel-num">{entry.threeCoinsComplete}</span>
              </strong>
              <strong
                className="group-result__metric"
                aria-label={`${t.groupCoinBagHitRate} ${formatGroupHitRate(entry.coinBagHits, entry.totalOpens)}`}
              >
                {withDuelNums(
                  formatGroupHitRate(entry.coinBagHits, entry.totalOpens),
                )}
              </strong>
              <button
                type="button"
                className="duel-btn duel-btn--quiet-top group-result__details"
                disabled={detailBusy}
                onClick={() => openDetails(entry.entryKey)}
                data-group-result-detail-index={index}
              >
                {t.groupViewDetails}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        className="duel-btn duel-btn--quiet-top group-result__top"
        onClick={onGoTop}
      >
        {t.duelReturnToTop}
      </button>
    </section>
  )
}
