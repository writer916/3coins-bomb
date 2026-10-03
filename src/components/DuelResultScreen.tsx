import { useCallback, useEffect, useRef, useState } from 'react'
import type { DuelFinalResult, DuelResultParticipantSummary } from '../duel/duelPlayClient'
import { resolveDuelResultPresentation } from '../duel/duelResultPresentation'
import type { AppStrings } from '../i18n'

export const DUEL_RESULT_POLL_INTERVAL_MS = 5_000

type DuelResultScreenProps = {
  readonly matchId: string
  readonly initialResult: DuelFinalResult
  readonly fetchResult: () => Promise<DuelFinalResult>
  readonly t: AppStrings
}

function StatRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: number
}) {
  return (
    <p className="duel-final-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  )
}

function PlayerCard({
  title,
  summary,
  t,
}: {
  readonly title: string
  readonly summary: DuelResultParticipantSummary
  readonly t: AppStrings
}) {
  return (
    <div className="duel-final-player">
      <h3>{title}</h3>
      <div className="duel-final-stats">
        <StatRow label={t.duelTotalCoins} value={summary.totalCapturedCoins} />
        <StatRow label={t.duelThreeCoinsComplete} value={summary.threeCoinsComplete} />
        <StatRow label={t.duelBombsHit} value={summary.bombsHit} />
      </div>
    </div>
  )
}

function CompletedResult({
  result,
  t,
}: {
  readonly result: Extract<DuelFinalResult, { status: 'completed' }>
  readonly t: AppStrings
}) {
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
        <PlayerCard title={t.duelYou} summary={self} t={t} />
        <PlayerCard title={t.duelOpponent} summary={opponent} t={t} />
      </div>
    </section>
  )
}

export function DuelResultScreen({
  matchId,
  initialResult,
  fetchResult,
  t,
}: DuelResultScreenProps) {
  const [result, setResult] = useState<DuelFinalResult>(initialResult)
  const [revealed, setRevealed] = useState(false)
  const fetchResultRef = useRef(fetchResult)
  fetchResultRef.current = fetchResult

  const phase = resolveDuelResultPresentation(matchId, result, revealed)

  useEffect(() => {
    if (phase !== 'waiting-for-opponent-complete') return

    let active = true
    let inFlight = false

    const refresh = async () => {
      if (!active || inFlight) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      inFlight = true
      try {
        const next = await fetchResultRef.current()
        if (!active) return
        setResult(next)
      } catch {
        /* keep waiting; one network error must not tear down the screen */
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, DUEL_RESULT_POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      active = false
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phase, matchId])

  const onReveal = useCallback(() => {
    if (result.status !== 'completed') return
    setRevealed(true)
  }, [result])

  if (phase === 'waiting-for-opponent-complete') {
    return (
      <section className="duel-final duel-final--waiting" aria-live="polite">
        <p className="duel-final-kicker">{t.duelWaitingTitle}</p>
        <p className="duel-final-copy">{t.duelWaitingBody}</p>
      </section>
    )
  }

  if (phase === 'result-ready') {
    return (
      <section className="duel-final duel-final--ready" aria-live="polite">
        <button
          type="button"
          className="dev-btn"
          onClick={onReveal}
        >
          {t.duelViewResult}
        </button>
      </section>
    )
  }

  if (result.status !== 'completed') {
    return (
      <section className="duel-final duel-final--waiting" aria-live="polite">
        <p className="duel-final-kicker">{t.duelWaitingTitle}</p>
        <p className="duel-final-copy">{t.duelWaitingBody}</p>
      </section>
    )
  }

  return <CompletedResult result={result} t={t} />
}
