import { useEffect, useRef, useState } from 'react'
import {
  createDuelClaimBootstrapCoordinator,
  type DuelClaimBootstrapResult,
} from '../duel/duelClaim'
import type { AppStrings } from '../i18n'

type DuelClaimBootstrapProps = {
  readonly initialUrl: string
  readonly t: AppStrings
}

type BootstrapViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'success'; readonly result: DuelClaimBootstrapResult }
  | { readonly phase: 'error' }

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

  const message =
    state.phase === 'loading'
      ? t.duelJoining
      : state.phase === 'error'
        ? t.duelJoinError
        : state.result.kind === 'participant-a'
          ? t.duelCreatorInviteOpened
          : t.duelJoined

  return (
    <main className="app app--duel">
      <div className="field-header">
        <header className="app-header">
          <h1 className="brand-title duel-setup-heading" aria-label={t.modeDuelName}>
            {t.modeDuelName}
          </h1>
        </header>
      </div>
      <div className="duel-flow duel-flow--locked">
        <div className="duel-status-slot" aria-hidden="true" />
        <p className="duel-locked-label" role={state.phase === 'error' ? 'alert' : undefined}>
          {message}
        </p>
      </div>
    </main>
  )
}
