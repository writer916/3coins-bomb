import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  createDuelClaimBootstrapCoordinator,
  type DuelClaimBootstrapResult,
  type DuelParticipantState,
} from '../duel/duelClaim'
import { createDuelPlayClient } from '../duel/duelPlayClient'
import {
  resolveDuelLockedResume,
  type DuelLockedResumeRoute,
} from '../duel/duelLockedResume'
import type { AppStrings } from '../i18n'
import { DuelFlow } from './DuelFlow'
import { DuelInvitePanel } from './DuelInvitePanel'
import { DuelPlayScreen } from './DuelPlayScreen'
import { DuelResultScreen } from './DuelResultScreen'

type DuelClaimBootstrapProps = {
  readonly initialUrl: string
  readonly t: AppStrings
  readonly onGoTop?: () => void
}

type BootstrapViewState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'success'
      readonly result: DuelClaimBootstrapResult
      readonly lockedResume: DuelLockedResumeRoute | null
    }
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

function matchSnapshot(state: DuelParticipantState) {
  return {
    matchId: state.matchId,
    self: state.self,
    opponent: state.opponent,
  }
}

export function DuelClaimBootstrap({
  initialUrl,
  t,
  onGoTop,
}: DuelClaimBootstrapProps) {
  const [state, setState] = useState<BootstrapViewState>({ phase: 'loading' })
  const coordinatorRef = useRef<ReturnType<
    typeof createDuelClaimBootstrapCoordinator
  > | null>(null)
  const playClientRef = useRef<ReturnType<typeof createDuelPlayClient> | null>(
    null,
  )
  playClientRef.current ??= createDuelPlayClient({
    storage: window.localStorage,
    fetch: window.fetch.bind(window),
    crypto: window.crypto,
  })

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
      .then(async (result) => {
        if (!active) return
        if (!result.state.self.placementLocked) {
          setState({ phase: 'success', result, lockedResume: null })
          return
        }
        try {
          const client = playClientRef.current
          if (!client) {
            if (active) setState({ phase: 'error' })
            return
          }
          const lockedResume = await resolveDuelLockedResume({
            match: matchSnapshot(result.state),
            fetchResult: () => client.getFinalResult(result.matchId),
          })
          if (active) setState({ phase: 'success', result, lockedResume })
        } catch {
          if (active) setState({ phase: 'error' })
        }
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

  const { result, lockedResume } = state

  if (lockedResume) {
    if (lockedResume.kind === 'waiting-for-opponent-lock') {
      return (
        <DuelBootstrapShell t={t}>
          <DuelInvitePanel matchId={lockedResume.matchId} t={t} onGoTop={onGoTop} />
        </DuelBootstrapShell>
      )
    }
    if (lockedResume.kind === 'play') {
      return (
        <DuelBootstrapShell t={t}>
          <DuelPlayScreen matchId={lockedResume.matchId} t={t} />
        </DuelBootstrapShell>
      )
    }
    const client = playClientRef.current
    if (!client) {
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
    return (
      <DuelBootstrapShell t={t}>
        <DuelResultScreen
          matchId={lockedResume.matchId}
          initialResult={lockedResume.initialResult}
          fetchResult={() => client.getFinalResult(lockedResume.matchId)}
          t={t}
        />
      </DuelBootstrapShell>
    )
  }

  // Unlocked A #p: existing-match placement from ROUND 1 (no create).
  if (result.kind === 'participant-a') {
    return (
      <DuelBootstrapShell t={t}>
        <DuelFlow
          t={t}
          onGoTop={onGoTop}
          participantA={{
            matchId: result.matchId,
            totalRounds: result.state.totalRounds,
            createdAt: result.state.createdAt,
          }}
          initiallyLocked={false}
        />
      </DuelBootstrapShell>
    )
  }

  return (
    <DuelBootstrapShell t={t}>
      <DuelFlow
        t={t}
        onGoTop={onGoTop}
        participantB={{
          matchId: result.matchId,
          totalRounds: result.state.totalRounds,
          createdAt: result.state.createdAt,
        }}
        initiallyLocked={false}
      />
    </DuelBootstrapShell>
  )
}
