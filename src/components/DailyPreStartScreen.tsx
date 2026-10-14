import { useMemo, useState } from 'react'
import { utcDailyChallengeDate } from '../daily/dailyChallengeDate'
import { DAILY_CHALLENGE_ROUNDS } from '../daily/dailyQuestionSet'
import {
  readDailyParticipant,
  type JoinedDailyParticipantRecord,
} from '../daily/dailyParticipantStorage'
import {
  DAILY_ROUND_LIMIT_SECONDS,
  formatDailyChallengePeriod,
} from '../daily/dailyTime'
import type { AppStrings } from '../i18n'
import { withDuelNums } from '../ui/withDuelNums'

export type DailyPreStartScreenProps = {
  readonly t: AppStrings
  readonly onGoTop: () => void
  /** Injected for tests; defaults to the device zone. */
  readonly timeZone?: string
  /** Injected for tests; defaults to `Date`. */
  readonly now?: () => Date
  /** Injected for tests; defaults to `window.localStorage`. */
  readonly storage?: Storage
}

function readJoinedSnapshot(
  challengeDate: string,
  storage: Storage | undefined,
): {
  readonly joined: JoinedDailyParticipantRecord | null
  readonly storageError: boolean
} {
  try {
    const adapter =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : undefined)
    if (!adapter) return { joined: null, storageError: false }
    const record = readDailyParticipant(adapter, challengeDate)
    if (record?.phase === 'joined') {
      return { joined: record, storageError: false }
    }
    return { joined: null, storageError: false }
  } catch {
    return { joined: null, storageError: true }
  }
}

/**
 * DAILY CHALLENGE pre-start: rules, local schedule, nickname field, and a
 * disabled START until JOIN → ROUND 1 wiring exists. Skips any ready gate.
 */
export function DailyPreStartScreen({
  t,
  onGoTop,
  timeZone,
  now,
  storage,
}: DailyPreStartScreenProps) {
  const challengeDate = useMemo(
    () => utcDailyChallengeDate(now?.() ?? new Date()),
    [now],
  )

  const period = useMemo(() => {
    const zone =
      timeZone ??
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'UTC')
    return formatDailyChallengePeriod(challengeDate, zone)
  }, [challengeDate, timeZone])

  const { joined, storageError } = useMemo(
    () => readJoinedSnapshot(challengeDate, storage),
    [challengeDate, storage],
  )

  const [nickname, setNickname] = useState('')

  return (
    <div className="duel-flow duel-flow--setup daily-prestart">
      <div className="duel-setup-hero daily-prestart__hero">
        <ul className="duel-start-confirm__list daily-prestart__rules">
          <li>
            <span className="duel-start-confirm__label">{t.dailyRoundsLabel}</span>
            <span className="duel-start-confirm__value">
              {withDuelNums(t.dailyRoundsValue(DAILY_CHALLENGE_ROUNDS))}
            </span>
          </li>
          <li>
            <span className="duel-start-confirm__label">
              {t.dailyTimeLimitLabel}
            </span>
            <span className="duel-start-confirm__value">
              {withDuelNums(t.dailyTimeLimitValue(DAILY_ROUND_LIMIT_SECONDS))}
            </span>
          </li>
          <li>
            <span className="duel-start-confirm__label">{t.dailyTimeoutLabel}</span>
            <span className="duel-start-confirm__value">
              {withDuelNums(t.dailyTimeoutValue)}
            </span>
          </li>
        </ul>
        <p className="duel-instruction daily-prestart__ranking">
          {withDuelNums(t.dailyRankingRule)}
        </p>
        <p className="daily-prestart__period-label">{t.dailyPeriodLabel}</p>
        <p className="daily-prestart__period-value">
          {withDuelNums(t.dailyPeriodRange(period.startsAt, period.endsAt))}
        </p>
        {joined ? (
          <p className="daily-prestart__joined" role="status">
            {withDuelNums(t.dailyJoinedStatus(joined.nickname))}
          </p>
        ) : (
          <>
            <p className="duel-instruction">{t.dailyNicknameLead}</p>
            <div className="duel-field">
              <input
                id="daily-nickname"
                className="group-nickname-input"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                autoComplete="nickname"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t.dailyNicknamePlaceholder}
                aria-label={t.dailyNicknameLabel}
              />
            </div>
          </>
        )}
        {storageError ? (
          <p className="duel-lock-error" role="alert">
            {t.dailyStorageReadError}
          </p>
        ) : null}
        <p className="daily-prestart__start-hint" role="note">
          {t.dailyStartDisabledHint}
        </p>
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
      <div className="duel-btn-area duel-button-field">
        <div className="duel-btn-stack standard-action-stack">
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            disabled
            aria-disabled="true"
          >
            {t.dailyStart}
          </button>
          <button type="button" className="duel-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        </div>
      </div>
    </div>
  )
}
