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
import { DuelStartConfirm } from './DuelStartConfirm'

type DuelClaimBootstrapProps = {
  readonly initialUrl: string
  readonly t: AppStrings
  readonly onGoTop?: () => void
  /** App-owned language/sound controls (same node as TOP / DUEL). */
  readonly topControls: ReactNode
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
  topControls,
  children,
}: {
  readonly t: AppStrings
  readonly topControls: ReactNode
  readonly children: ReactNode
}) {
  return (
    <main className="app app--duel">
      <div className="field-header">
        {topControls}
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

/** Resume start-confirm → session-only START → PLAY (Eng2 component reused). */
function DuelResumeStartConfirm({
  matchId,
  createdAt,
  totalRounds,
  t,
  onGoTop,
}: {
  readonly matchId: string
  readonly createdAt: string
  readonly totalRounds: number
  readonly t: AppStrings
  readonly onGoTop?: () => void
}) {
  const [startedPlay, setStartedPlay] = useState(false)
  if (startedPlay) {
    return <DuelPlayScreen matchId={matchId} t={t} onGoTop={onGoTop} />
  }
  return (
    <DuelStartConfirm
      createdAt={createdAt}
      totalRounds={totalRounds}
      t={t}
      onStart={() => setStartedPlay(true)}
      onGoTop={onGoTop}
    />
  )
}

export function DuelClaimBootstrap({
  initialUrl,
  t,
  onGoTop,
  topControls,
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
            fetchPlayState: () => client.getPlayState(result.matchId),
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
      <DuelBootstrapShell t={t} topControls={topControls}>
        <div className="duel-flow duel-flow--locked">
          <div className="duel-status-slot" aria-hidden="true" />
          <p className="duel-locked-label">{t.duelJoining}</p>
        </div>
      </DuelBootstrapShell>
    )
  }

  if (state.phase === 'error') {
    return (
      <DuelBootstrapShell t={t} topControls={topControls}>
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
        <DuelBootstrapShell t={t} topControls={topControls}>
          <DuelInvitePanel matchId={lockedResume.matchId} t={t} onGoTop={onGoTop} />
        </DuelBootstrapShell>
      )
    }
    if (lockedResume.kind === 'start-confirm') {
      return (
        <DuelBootstrapShell t={t} topControls={topControls}>
          <DuelResumeStartConfirm
            matchId={lockedResume.matchId}
            createdAt={result.state.createdAt}
            totalRounds={result.state.totalRounds}
            t={t}
            onGoTop={onGoTop}
          />
        </DuelBootstrapShell>
      )
    }
    if (lockedResume.kind === 'play') {
      return (
        <DuelBootstrapShell t={t} topControls={topControls}>
          <DuelPlayScreen matchId={lockedResume.matchId} t={t} onGoTop={onGoTop} />
        </DuelBootstrapShell>
      )
    }
    const client = playClientRef.current
    if (!client) {
      return (
        <DuelBootstrapShell t={t} topControls={topControls}>
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
      <DuelBootstrapShell t={t} topControls={topControls}>
        <DuelResultScreen
          matchId={lockedResume.matchId}
          initialResult={lockedResume.initialResult}
          fetchResult={() => client.getFinalResult(lockedResume.matchId)}
          t={t}
          onGoTop={onGoTop}
        />
      </DuelBootstrapShell>
    )
  }

  // Unlocked A #p: existing-match placement from ROUND 1 (no create).
  if (result.kind === 'participant-a') {
    return (
      <DuelBootstrapShell t={t} topControls={topControls}>
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
    <DuelBootstrapShell t={t} topControls={topControls}>
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
