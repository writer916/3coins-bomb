import { useCallback, useRef, useState } from 'react'
import {
  GROUP_PLAYERS_MAX,
  GROUP_PLAYERS_MIN,
  GROUP_ROUNDS_MAX,
  GROUP_ROUNDS_MIN,
} from '../group/groupDomain'
import { createGroupCreateCoordinator } from '../group/groupCreateClient'
import { readPendingGroupCreate } from '../group/groupPersistence'
import type { AppStrings } from '../i18n'
import { NumberStepper } from './NumberStepper'

type GroupCreateFlowProps = {
  readonly t: AppStrings
  readonly onGoTop: () => void
  readonly onCreated: (invitationUrl: string) => void
}

function initialSettings(): { totalRounds: number; playerLimit: number } {
  try {
    const pending = readPendingGroupCreate(window.localStorage)
    if (pending) {
      return {
        totalRounds: pending.totalRounds,
        playerLimit: pending.playerLimit,
      }
    }
  } catch {
    /* The create action will show the normal safe error. */
  }
  return { totalRounds: 3, playerLimit: 2 }
}

function ConfigShell({
  hint,
  stepper,
  primary,
  secondary,
  error,
}: {
  readonly hint: string
  readonly stepper: React.ReactNode
  readonly primary: React.ReactNode
  readonly secondary: React.ReactNode
  readonly error?: string | null
}) {
  return (
    <div className="duel-flow duel-flow--setup group-create-flow">
      <div className="duel-status-slot" aria-hidden="true" />
      <div className="duel-setup-spacer duel-setup-spacer--top" aria-hidden="true" />
      <div className="duel-setup-hero">
        <p className="duel-instruction">{hint}</p>
        <div className="duel-field duel-field--stepper">{stepper}</div>
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
      <div className="duel-btn-area duel-button-field">
        {/*
          Overlay only: must not occupy btn-stack flow, or PLAYERS Y drifts
          vs ROUNDS (shared 3-button field pins first-button top).
        */}
        {error ? (
          <p className="duel-lock-error duel-lock-error--slot" role="alert">
            {error}
          </p>
        ) : null}
        <div className="duel-btn-stack standard-action-stack">
          {primary}
          {secondary}
        </div>
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true" />
    </div>
  )
}

export function GroupCreateFlow({ t, onGoTop, onCreated }: GroupCreateFlowProps) {
  const [initial] = useState(initialSettings)
  const [phase, setPhase] = useState<'rounds' | 'players'>('rounds')
  const [totalRounds, setTotalRounds] = useState(initial.totalRounds)
  const [playerLimit, setPlayerLimit] = useState(initial.playerLimit)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const pendingRef = useRef(false)
  const coordinatorRef = useRef<ReturnType<typeof createGroupCreateCoordinator> | null>(null)

  const create = useCallback(async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setFailed(false)
    try {
      coordinatorRef.current ??= createGroupCreateCoordinator({
        storage: window.localStorage,
        fetch: window.fetch.bind(window),
        crypto: window.crypto,
        origin: window.location.origin,
      })
      const result = await coordinatorRef.current.run({ totalRounds, playerLimit })
      onCreated(result.invitationUrl)
    } catch {
      setFailed(true)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [onCreated, playerLimit, totalRounds])

  if (phase === 'rounds') {
    return (
      <ConfigShell
        hint={t.groupRoundsHint}
        stepper={
          <NumberStepper
            label={t.groupRoundsLabel}
            value={totalRounds}
            min={GROUP_ROUNDS_MIN}
            max={GROUP_ROUNDS_MAX}
            onChange={setTotalRounds}
            valueAriaLabel={`${t.groupRoundsLabel} ${totalRounds}`}
          />
        }
        primary={
          <button type="button" className="duel-btn duel-btn--primary" onClick={() => setPhase('players')}>
            {t.groupContinue}
          </button>
        }
        secondary={
          <button type="button" className="duel-btn" onClick={onGoTop}>
            {t.duelTop}
          </button>
        }
      />
    )
  }

  return (
    <ConfigShell
      hint={t.groupPlayersHint}
      stepper={
        <NumberStepper
          label={t.groupPlayersLabel}
          value={playerLimit}
          min={GROUP_PLAYERS_MIN}
          max={GROUP_PLAYERS_MAX}
          onChange={setPlayerLimit}
          valueAriaLabel={`${t.groupPlayersLabel} ${playerLimit}`}
          disabled={pending}
        />
      }
      error={failed ? t.groupCreateError : null}
      primary={
        <button
          type="button"
          className={`duel-btn duel-btn--primary${
            pending
              ? ''
              : t.groupCreate === 'CREATE GROUP'
                ? ' standard-action-btn--create-group-en'
                : ' standard-action-btn--create-group-ja'
          }`}
          onClick={create}
          disabled={pending}
        >
          {pending ? t.groupCreating : t.groupCreate}
        </button>
      }
      secondary={
        <button type="button" className="duel-btn" onClick={() => setPhase('rounds')} disabled={pending}>
          {t.duelBack}
        </button>
      }
    />
  )
}
