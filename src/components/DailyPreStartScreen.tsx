import { useMemo, useState } from 'react'
import { utcDailyChallengeDate } from '../daily/dailyChallengeDate'
import { DAILY_CHALLENGE_ROUNDS } from '../daily/dailyQuestionSet'
import {
  createDailyParticipantCoordinator,
  DailyParticipantClientError,
} from '../daily/dailyParticipantClient'
import {
  readDailyParticipant,
  type JoinedDailyParticipantRecord,
} from '../daily/dailyParticipantStorage'
import {
  createDailyPlayClient,
  createDailyPlayCoordinator,
  DailyPlayClientError,
  type DailyPlayCoordinator,
  type DailyPlayState,
} from '../daily/dailyPlayClient'
import {
  DAILY_ROUND_LIMIT_SECONDS,
  formatDailyChallengePeriod,
} from '../daily/dailyTime'
import type { AppStrings } from '../i18n'
import { withDuelNums } from '../ui/withDuelNums'

export type DailyPreStartScreenProps = {
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly onEnterPlay: (input: {
    readonly state: DailyPlayState
    readonly coordinator: DailyPlayCoordinator
  }) => void
  /** Injected for tests; defaults to the device zone. */
  readonly timeZone?: string
  /** Injected for tests; defaults to `Date`. */
  readonly now?: () => Date
  /** Injected for tests; defaults to `window.localStorage`. */
  readonly storage?: Storage
  readonly fetch?: typeof fetch
  readonly crypto?: Crypto
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
 * DAILY CHALLENGE pre-start: rules, nickname JOIN, then START → ROUND 1.
 * No ready gate between JOIN and play.
 */
export function DailyPreStartScreen({
  t,
  onGoTop,
  onEnterPlay,
  timeZone,
  now,
  storage,
  fetch: fetchImpl,
  crypto: cryptoImpl,
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

  const initialJoined = useMemo(
    () => readJoinedSnapshot(challengeDate, storage),
    [challengeDate, storage],
  )

  const [nickname, setNickname] = useState('')
  const [joined, setJoined] = useState<JoinedDailyParticipantRecord | null>(
    initialJoined.joined,
  )
  const [storageError] = useState(initialJoined.storageError)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const storageAdapter =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined)
  const fetcher = fetchImpl ?? fetch
  const cryptoApi =
    cryptoImpl ??
    (typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined)

  const canStart =
    !storageError &&
    !busy &&
    ((joined !== null) || nickname.trim().length > 0) &&
    cryptoApi !== undefined &&
    storageAdapter !== undefined

  const handleStart = async () => {
    if (!canStart || !storageAdapter || !cryptoApi) return
    setBusy(true)
    setError(false)
    try {
      const participantCoordinator = createDailyParticipantCoordinator({
        storage: storageAdapter,
        fetch: fetcher,
        crypto: cryptoApi,
        now: now ?? (() => new Date()),
      })
      const participantResult = await participantCoordinator.run(
        joined?.nickname ?? nickname,
      )
      setJoined(participantResult.participant)

      const playClient = createDailyPlayClient({
        storage: storageAdapter,
        fetch: fetcher,
        crypto: cryptoApi,
      })
      const playCoordinator = createDailyPlayCoordinator(playClient)
      const state = await playCoordinator.loadOrStart(
        participantResult.participant.challengeDate,
      )
      if (!state.activeAttempt && !state.completedAt && !state.expiredAt) {
        throw new Error('no active round')
      }
      onEnterPlay({ state, coordinator: playCoordinator })
    } catch (caught: unknown) {
      if (
        caught instanceof DailyParticipantClientError ||
        caught instanceof DailyPlayClientError
      ) {
        setError(true)
      } else {
        setError(true)
      }
    } finally {
      setBusy(false)
    }
  }

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
                disabled={busy}
              />
            </div>
          </>
        )}
        {storageError ? (
          <p className="duel-lock-error" role="alert">
            {t.dailyStorageReadError}
          </p>
        ) : null}
        {error ? (
          <p className="duel-lock-error" role="alert">
            {t.dailyPlayError}
          </p>
        ) : null}
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
      <div className="duel-btn-area duel-button-field">
        <div className="duel-btn-stack standard-action-stack">
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            disabled={!canStart}
            aria-disabled={!canStart ? 'true' : undefined}
            onClick={() => {
              void handleStart()
            }}
          >
            {t.dailyStart}
          </button>
          <button type="button" className="duel-btn" onClick={onGoTop} disabled={busy}>
            {t.duelTop}
          </button>
        </div>
      </div>
    </div>
  )
}
