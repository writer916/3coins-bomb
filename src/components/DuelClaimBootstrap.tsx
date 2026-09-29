import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  createDuelClaimBootstrapCoordinator,
  type DuelClaimBootstrapResult,
} from '../duel/duelClaim'
import type { AppStrings } from '../i18n'
import { DuelFlow } from './DuelFlow'

type DuelClaimBootstrapProps = {
  readonly initialUrl: string
  readonly t: AppStrings
}

type BootstrapViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'success'; readonly result: DuelClaimBootstrapResult }
  | { readonly phase: 'error' }

function DuelBootstrapShell({
  t,
  children,
}: {
  readonly t: AppStrings
  readonly children: ReactNode
}) {
  return (
    <main className="app app--duel">
      <div className="field-header">
        <header className="app-header">
          <h1 className="brand-title duel-setup-heading" aria-label={t.modeDuelName}>
            {t.modeDuelName}
          </h1>
        </header>
      </div>
      {children}
    </main>
  )
}

export function DuelClaimBootstrap({ initialUrl, t }: DuelClaimBootstrapProps) {
  const [state, setState] = useState<BootstrapViewState>({ phase: 'loading' })
  const coordinatorRef = useRef<ReturnType<
    typeof createDuelClaimBootstrapCoordinator
  > | null>(null)

  useEffect(() => {
    let active = true
    coordinatorRef.current ??= createDuelClaimBootstrapCoordinator({
      storage: window.localStorage,
      history: window.history,
      fetch: window.fetch.bind(window),
      crypto: window.crypto,
    })
    void coordinatorRef.current
      .run(initialUrl)
      .then((result) => {
        if (active) setState({ phase: 'success', result })
      })
      .catch(() => {
        if (active) setState({ phase: 'error' })
      })
    return () => {
      active = false
    }
  }, [initialUrl])

  if (state.phase === 'loading') {
    return (
      <DuelBootstrapShell t={t}>
        <div className="duel-flow duel-flow--locked">
          <div className="duel-status-slot" aria-hidden="true" />
          <p className="duel-locked-label">{t.duelJoining}</p>
        </div>
      </DuelBootstrapShell>
    )
  }

  if (state.phase === 'error') {
    return (
      <DuelBootstrapShell t={t}>
        <div className="duel-flow duel-flow--locked">
          <div className="duel-status-slot" aria-hidden="true" />
          <p className="duel-locked-label" role="alert">
            {t.duelJoinError}
          </p>
        </div>
      </DuelBootstrapShell>
    )
  }

  if (state.result.kind === 'participant-a') {
    return (
      <DuelBootstrapShell t={t}>
        <div className="duel-flow duel-flow--locked">
          <div className="duel-status-slot" aria-hidden="true" />
          <p className="duel-locked-label">{t.duelCreatorInviteOpened}</p>
        </div>
      </DuelBootstrapShell>
    )
  }

  return (
    <DuelBootstrapShell t={t}>
      <DuelFlow
        t={t}
        participantB={{
          matchId: state.result.matchId,
          totalRounds: state.result.state.totalRounds,
        }}
        initiallyLocked={state.result.state.self.placementLocked}
      />
    </DuelBootstrapShell>
  )
}
