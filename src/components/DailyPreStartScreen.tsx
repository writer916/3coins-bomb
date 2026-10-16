import { useEffect, useMemo, useRef, useState } from 'react'
import { utcDailyChallengeDate } from '../daily/dailyChallengeDate'
import {
  createDailyParticipantCoordinator,
  DailyParticipantClientError,
} from '../daily/dailyParticipantClient'
import { dailyEntryStateFromParticipant } from '../daily/dailyPreStartState'
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
import { formatDailyChallengePeriod } from '../daily/dailyTime'
import type { AppStrings } from '../i18n'
import type { LocaleId } from '../i18n/types'
import { withDuelNums } from '../ui/withDuelNums'

export type DailyPreStartScreenProps = {
  readonly t: AppStrings
  readonly locale: LocaleId
  readonly onGoTop: () => void
  readonly onEnterPlay: (input: {
    readonly state: DailyPlayState
    readonly coordinator: DailyPlayCoordinator
  }) => void
  readonly onShowResult: (challengeDate: string) => void
  /** Injected for tests; defaults to `Date`. */
  readonly now?: () => Date
  /** Injected for tests; defaults to `window.localStorage`. */
  readonly storage?: Storage
  readonly fetch?: typeof fetch
  readonly crypto?: Crypto
}

type DailyStartStage =
  | 'participant-join'
  | 'participant-restore'
  | 'placements'
  | 'play'
  | 'round-start'
  | 'play-state'

type DailyEntryState =
  | 'unjoined'
  | 'checking'
  | 'playing'
  | 'completed'
  | 'status-error'

function reportDailyStartFailure(stage: DailyStartStage, caught: unknown): void {
  if (!import.meta.env.DEV) return
  const error = caught instanceof Error ? caught : null
  const code =
    error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  // Never log request data, response bodies, participant details, or capabilities.
  console.error('[DAILY START]', {
    stage,
    error: error?.name ?? 'UnknownError',
    ...(code ? { code } : {}),
  })
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
  locale,
  onGoTop,
  onEnterPlay,
  onShowResult,
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
    return formatDailyChallengePeriod(challengeDate, 'Asia/Tokyo')
  }, [challengeDate])

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
  const [entryState, setEntryState] = useState<DailyEntryState>(
    initialJoined.joined ? 'checking' : 'unjoined',
  )
  const [statusRetry, setStatusRetry] = useState(0)
  const startInFlightRef = useRef(false)
  const mountedRef = useRef(true)

  const storageAdapter =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined)
  const fetcher = fetchImpl ?? fetch
  const cryptoApi =
    cryptoImpl ??
    (typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined)

  const participantCoordinator = useMemo(() => {
    if (!storageAdapter || !cryptoApi) return null
    return createDailyParticipantCoordinator({
      storage: storageAdapter,
      fetch: fetcher,
      crypto: cryptoApi,
      now: now ?? (() => new Date()),
    })
  }, [cryptoApi, fetcher, now, storageAdapter])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const participant = initialJoined.joined
    if (!participant || !participantCoordinator) return
    let cancelled = false
    void participantCoordinator.run(participant.nickname).then(
      (result) => {
        if (cancelled || !mountedRef.current) return
        setJoined(result.participant)
        setEntryState(dailyEntryStateFromParticipant(result.view))
      },
      (caught: unknown) => {
        if (cancelled || !mountedRef.current) return
        reportDailyStartFailure('participant-restore', caught)
        setEntryState('status-error')
        setError(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [initialJoined.joined, participantCoordinator, statusRetry])

  const canStart =
    !storageError &&
    !busy &&
    ((entryState === 'unjoined' && nickname.trim().length > 0) ||
      entryState === 'playing') &&
    cryptoApi !== undefined &&
    storageAdapter !== undefined

  const canPrimaryAction =
    entryState === 'completed' ||
    entryState === 'status-error' ||
    canStart

  const primaryLabel =
    entryState === 'checking'
      ? t.dailyStatusLoading
      : entryState === 'playing'
        ? t.dailyContinue
        : entryState === 'completed'
          ? t.dailyViewResult
          : entryState === 'status-error'
            ? t.dailyStatusRetry
            : t.dailyStart

  const handleStart = async () => {
    if (
      !canStart ||
      !storageAdapter ||
      !cryptoApi ||
      !participantCoordinator ||
      startInFlightRef.current
    ) {
      return
    }
    startInFlightRef.current = true
    setBusy(true)
    setError(false)
    let stage: DailyStartStage = joined ? 'participant-restore' : 'participant-join'
    try {
      const participantResult = await participantCoordinator.run(
        joined?.nickname ?? nickname,
      )
      if (mountedRef.current) setJoined(participantResult.participant)
      const restoredEntryState = dailyEntryStateFromParticipant(
        participantResult.view,
      )
      if (mountedRef.current) setEntryState(restoredEntryState)
      if (restoredEntryState === 'completed') {
        if (mountedRef.current) {
          onShowResult(participantResult.participant.challengeDate)
        }
        return
      }

      const playClient = createDailyPlayClient({
        storage: storageAdapter,
        fetch: fetcher,
        crypto: cryptoApi,
      })
      const diagnosticPlayClient = {
        ...playClient,
        async getPlacements(challengeDate: string) {
          stage = 'placements'
          return playClient.getPlacements(challengeDate)
        },
        async getPlay(challengeDate: string) {
          stage = 'play'
          return playClient.getPlay(challengeDate)
        },
        async startRound(challengeDate: string, requestId?: string) {
          stage = 'round-start'
          return playClient.startRound(challengeDate, requestId)
        },
      }
      const playCoordinator = createDailyPlayCoordinator(diagnosticPlayClient, {
        storage: window.sessionStorage,
        participantId: participantResult.participant.participantId,
      })
      const state = await playCoordinator.loadOrStart(
        participantResult.participant.challengeDate,
      )
      const hasPendingOperation =
        playCoordinator.getPendingOpen() !== null ||
        playCoordinator.getPendingCashOut() !== null
      if (
        !state.activeAttempt &&
        !state.latestTerminalAttempt &&
        !hasPendingOperation &&
        !state.completedAt &&
        !state.expiredAt
      ) {
        stage = 'play-state'
        throw new Error('no active round')
      }
      if (mountedRef.current) onEnterPlay({ state, coordinator: playCoordinator })
    } catch (caught: unknown) {
      reportDailyStartFailure(stage, caught)
      if (
        caught instanceof DailyParticipantClientError ||
        caught instanceof DailyPlayClientError
      ) {
        if (mountedRef.current) setError(true)
      } else {
        if (mountedRef.current) setError(true)
      }
    } finally {
      startInFlightRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  const handlePrimaryAction = () => {
    if (entryState === 'completed' && joined) {
      if (startInFlightRef.current) return
      startInFlightRef.current = true
      onShowResult(joined.challengeDate)
      return
    }
    if (entryState === 'status-error') {
      setEntryState('checking')
      setError(false)
      setStatusRetry((value) => value + 1)
      return
    }
    void handleStart()
  }

  return (
    <div
      className={`duel-flow duel-flow--setup daily-prestart daily-prestart--${locale}`}
    >
      <div className="duel-setup-hero daily-prestart__hero">
        <div className="daily-prestart__prose">
          <p className="duel-instruction daily-prestart__intro">
            {withDuelNums(t.dailyIntroRule)}
          </p>
          <p className="duel-instruction daily-prestart__ranking">
            {withDuelNums(t.dailyRankingRule)}
          </p>
          {t.dailyServerArrivalRule ? (
            <p className="duel-instruction daily-prestart__server-arrival">
              {withDuelNums(t.dailyServerArrivalRule)}
            </p>
          ) : null}
          <p className="duel-instruction daily-prestart__same-browser">
            {withDuelNums(t.dailySameBrowserRule)}
          </p>
        </div>
        <p className="daily-prestart__period">
          <span className="daily-prestart__period-label">{t.dailyPeriodLabel}</span>
          <span className="daily-prestart__period-value">
            {withDuelNums(t.dailyPeriodRange(period.startsAt, period.endsAt))}
          </span>
        </p>
        {entryState === 'checking' ? (
          <p
            className="daily-prestart__joined"
            aria-hidden="true"
            data-daily-status-placeholder=""
          />
        ) : joined && entryState === 'playing' ? (
          <p className="daily-prestart__joined" role="status">
            {withDuelNums(t.dailyPlayingStatus(joined.nickname))}
          </p>
        ) : joined && entryState === 'completed' ? (
          <p className="daily-prestart__joined" role="status">
            {withDuelNums(t.dailyCompletedStatus(joined.nickname))}
          </p>
        ) : entryState === 'unjoined' ? (
          <>
            <p className="duel-instruction daily-prestart__nickname-lead">
              {t.dailyNicknameLead}
            </p>
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
        ) : null}
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
            disabled={!canPrimaryAction}
            aria-disabled={!canPrimaryAction ? 'true' : undefined}
            onClick={handlePrimaryAction}
          >
            {primaryLabel}
          </button>
          <button type="button" className="duel-btn" onClick={onGoTop} disabled={busy}>
            {t.duelTop}
          </button>
        </div>
      </div>
    </div>
  )
}
