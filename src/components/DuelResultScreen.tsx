import type { DuelFinalResult, DuelResultParticipantSummary } from '../duel/duelPlayClient'
import type { AppStrings } from '../i18n'

type DuelResultScreenProps = {
  readonly result: DuelFinalResult
  readonly pending: boolean
  readonly error: boolean
  readonly onCheck: () => void
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
      <StatRow label={t.duelTotalCoins} value={summary.totalCapturedCoins} />
      <StatRow label={t.duelThreeCoinsComplete} value={summary.threeCoinsComplete} />
      <StatRow label={t.duelBombsHit} value={summary.bombsHit} />
    </div>
  )
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
        <PlayerCard title={t.duelYou} summary={self} t={t} />
        <PlayerCard title={t.duelOpponent} summary={opponent} t={t} />
      </div>
    </section>
  )
}
