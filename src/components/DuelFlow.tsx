import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BagId } from '../game/assets'
import {
  backToBagsFromPlace,
  canComplete,
  canNextRound,
  clampDuelRounds,
  commitAndAdvance,
  completeSession,
  confirmBags,
  createDuelSession,
  DUEL_BAGS_MAX,
  DUEL_BAGS_MIN,
  DUEL_ROUNDS_DEFAULT,
  DUEL_ROUNDS_MAX,
  DUEL_ROUNDS_MIN,
  lockSession,
  placeBomb,
  placeCoin,
  resetCurrentRound,
  setBagsDraft,
  type DuelPlacementSession,
} from '../game/duelPlacement'
import type { AppStrings } from '../i18n'
import { createDuelALockCoordinator } from '../duel/duelCreateLock'
import { createDuelBLockCoordinator } from '../duel/duelParticipantLock'
import { withDuelNumsAndBreaks } from '../ui/withDuelNums'
import { BagBoard } from './BagBoard'
import { DuelInvitePanel } from './DuelInvitePanel'
import { DuelPlacementOverlay } from './DuelPlacementOverlay'
import { NumberStepper } from './NumberStepper'

export type DuelParticipantBConfig = {
  readonly matchId: string
  readonly totalRounds: number
}

type DuelFlowProps = {
  t: AppStrings
  /** Setup-only: return to mode select (no confirm). */
  onGoTop?: () => void
  /** Claimed B participant: fixed ROUND count and server LOCK without match create. */
  participantB?: DuelParticipantBConfig
  /** B already placement-locked on server (revisit). */
  initiallyLocked?: boolean
}

/** ROUND n / N — word stays Georgia; digits use SOLO score font. Width fits 20 / 20. */
function DuelRoundIndex({ current, total }: { current: number; total: number }) {
  return (
    <p
      className="duel-round-index"
      aria-label={`ROUND ${current} / ${total}`}
    >
      <span className="duel-round-index__word">ROUND</span>{' '}
      <span className="duel-round-index__nums">
        <span className="duel-num">{current}</span>
        {' / '}
        <span className="duel-num">{total}</span>
      </span>
    </p>
  )
}

/**
 * Shared ROUND/BAG settings shell — same Y for instruction / label / stepper / buttons.
 * Spacers keep module+button group as one band (CONTINUE ≈ place NEXT ROUND band).
 */
function DuelConfigShell({
  roundCurrent,
  roundTotal,
  hint,
  stepper,
  primary,
  secondary,
}: {
  roundCurrent?: number
  roundTotal?: number
  hint: string
  stepper: ReactNode
  primary: ReactNode
  secondary: ReactNode
}) {
  const showRound = roundCurrent != null && roundTotal != null
  return (
    <div className="duel-flow duel-flow--setup">
      <div
        className="duel-status-slot"
        aria-hidden={showRound ? undefined : true}
      >
        {showRound ? (
          <DuelRoundIndex current={roundCurrent} total={roundTotal} />
        ) : null}
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--top" aria-hidden="true" />
      <div className="duel-setup-hero">
        <p className="duel-instruction" data-duel-metric="instruction">
          {hint}
        </p>
        <div
          className="duel-field duel-field--stepper"
          data-duel-metric="stepper-field"
        >
          {stepper}
        </div>
      </div>
      {/* Grows so the module can sit higher while buttons stay pinned. */}
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />
      <div className="duel-btn-area" data-duel-metric="btn-area">
        <div className="duel-btn-stack" data-duel-metric="btn-stack">
          {primary}
          {secondary}
        </div>
      </div>
      <div className="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true" />
    </div>
  )
}

/**
 * DUEL placement flow (local only): setup → place all ROUNDs → COMPLETE → LOCK.
 */
export function DuelFlow({
  t,
  onGoTop,
  participantB,
  initiallyLocked = false,
}: DuelFlowProps) {
  const [roundsDraft, setRoundsDraft] = useState(DUEL_ROUNDS_DEFAULT)
  const [serverLocked, setServerLocked] = useState(initiallyLocked)
  const [lockedMatchId, setLockedMatchId] = useState<string | null>(
    participantB?.matchId ?? null,
  )
  const [session, setSession] = useState<DuelPlacementSession | null>(() => {
    if (initiallyLocked) return null
    if (participantB) return createDuelSession(participantB.totalRounds)
    return null
  })
  const [lockPending, setLockPending] = useState(false)
  const [lockError, setLockError] = useState(false)
  const lockPendingRef = useRef(false)
  const lockCoordinatorRef = useRef<ReturnType<
    typeof createDuelALockCoordinator
  > | null>(null)
  const bLockCoordinatorRef = useRef<ReturnType<
    typeof createDuelBLockCoordinator
  > | null>(null)

  const startSession = useCallback(() => {
    setSession(createDuelSession(roundsDraft))
  }, [roundsDraft])

  const onBackFromBags = useCallback(() => {
    // BAG setup BACK → ROUND setup (keep roundsDraft). No confirm.
    setSession(null)
  }, [])

  const onBackFromPlace = useCallback(() => {
    // Place BACK → this ROUND's BAGS setup; discard placement. No confirm.
    setSession((prev) => {
      if (!prev?.current || prev.locked) return prev
      return { ...prev, current: backToBagsFromPlace(prev.current) }
    })
  }, [])

  const onBagsChange = useCallback((n: number) => {
    setSession((prev) => {
      if (!prev?.current) return prev
      return { ...prev, current: setBagsDraft(prev.current, n) }
    })
  }, [])

  const onSetBags = useCallback(() => {
    setSession((prev) => {
      if (!prev?.current) return prev
      return { ...prev, current: confirmBags(prev.current) }
    })
  }, [])

  const onBagTap = useCallback((bagId: BagId) => {
    setSession((prev) => {
      if (!prev?.current || prev.locked) return prev
      const d = prev.current
      if (d.phase === 'place-bomb') {
        return { ...prev, current: placeBomb(d, bagId) }
      }
      if (d.phase === 'place-coins') {
        return { ...prev, current: placeCoin(d, bagId) }
      }
      return prev
    })
  }, [])

  const onResetRound = useCallback(() => {
    setSession((prev) => {
      if (!prev?.current || prev.locked) return prev
      return { ...prev, current: resetCurrentRound(prev.current) }
    })
  }, [])

  const onNextRound = useCallback(() => {
    setSession((prev) => (prev ? commitAndAdvance(prev) : prev))
  }, [])

  const onComplete = useCallback(() => {
    setSession((prev) => (prev ? completeSession(prev) : prev))
  }, [])

  const onStartOver = useCallback(() => {
    if (lockPendingRef.current) return
    if (!window.confirm(t.duelStartOverConfirm)) return
    if (participantB) {
      setSession(createDuelSession(participantB.totalRounds))
      setLockError(false)
      return
    }
    // Discard all local DUEL setup and return to mode select.
    setSession(null)
    setRoundsDraft(DUEL_ROUNDS_DEFAULT)
    onGoTop?.()
  }, [participantB, t.duelStartOverConfirm, onGoTop])

  const onLock = useCallback(async () => {
    if (lockPendingRef.current || !session?.awaitingLock) return
    lockPendingRef.current = true
    setLockPending(true)
    setLockError(false)
    try {
      if (participantB) {
        bLockCoordinatorRef.current ??= createDuelBLockCoordinator({
          storage: window.localStorage,
          fetch: window.fetch.bind(window),
        })
        await bLockCoordinatorRef.current.run({
          matchId: participantB.matchId,
          totalRounds: session.totalRounds,
          placements: session.completed,
        })
        setLockedMatchId(participantB.matchId)
      } else {
        lockCoordinatorRef.current ??= createDuelALockCoordinator({
          storage: window.localStorage,
          fetch: window.fetch.bind(window),
          crypto: window.crypto,
        })
        const locked = await lockCoordinatorRef.current.run({
          totalRounds: session.totalRounds,
          placements: session.completed,
        })
        setLockedMatchId(locked.matchId)
      }
      setSession((prev) => (prev ? lockSession(prev) : prev))
      setServerLocked(true)
    } catch {
      setLockError(true)
    } finally {
      lockPendingRef.current = false
      setLockPending(false)
    }
  }, [participantB, session])

  const draft = session?.current ?? null

  const placeCopy = useMemo(() => {
    if (!draft || draft.phase === 'select-bags') {
      return { instruction: null as string | null }
    }
    if (draft.phase === 'place-bomb') {
      return { instruction: t.duelPlaceBomb }
    }
    if (draft.phase === 'place-coins') {
      return { instruction: t.duelPlaceCoins }
    }
    if (draft.phase === 'ready') {
      return { instruction: t.duelReady }
    }
    return { instruction: null }
  }, [draft, t])

  if (serverLocked || session?.locked) {
    if (!participantB && lockedMatchId) {
      return <DuelInvitePanel matchId={lockedMatchId} t={t} />
    }
    return (
      <div className="duel-flow duel-flow--locked">
        <div className="duel-status-slot" aria-hidden="true" />
        <p className="duel-locked-label">{t.duelPlacementsLocked}</p>
      </div>
    )
  }

  /* ——— ROUND count setup (layout reference) ——— */
  if (!session) {
    return (
      <DuelConfigShell
        hint={t.duelRoundsHint}
        stepper={
          <NumberStepper
            label={t.duelRoundsLabel}
            value={roundsDraft}
            min={DUEL_ROUNDS_MIN}
            max={DUEL_ROUNDS_MAX}
            onChange={(n) => setRoundsDraft(clampDuelRounds(n))}
            valueAriaLabel={`${t.duelRoundsLabel} ${roundsDraft}`}
          />
        }
        primary={
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            data-duel-metric="primary"
            onClick={startSession}
          >
            {t.duelContinue}
          </button>
        }
        secondary={
          <button
            type="button"
            className="duel-btn"
            data-duel-metric="secondary"
            onClick={onGoTop}
          >
            {t.duelTop}
          </button>
        }
      />
    )
  }

  /* ——— Complete / await LOCK ——— */
  if (session.awaitingLock) {
    return (
      <div className="duel-flow duel-flow--complete">
        <div
          className="duel-complete-spacer duel-complete-spacer--top"
          aria-hidden="true"
        />
        <p className="duel-complete-summary">
          {t.duelRoundsReady}
        </p>
        {lockError ? (
          <p className="duel-lock-error" role="alert">
            {t.duelLockError}
          </p>
        ) : null}
        <div className="duel-field duel-field--actions duel-field--stack-actions">
          <div className="duel-btn-stack">
            {/* Primary confirm first (locale-agnostic layout). */}
            <button
              type="button"
              className="duel-btn duel-btn--primary"
              onClick={onLock}
              disabled={lockPending}
            >
              {lockPending ? t.duelLocking : t.duelLock}
            </button>
            <button
              type="button"
              className="duel-btn"
              onClick={onStartOver}
              disabled={lockPending}
            >
              {t.duelStartOver}
            </button>
          </div>
        </div>
        <div
          className="duel-complete-spacer duel-complete-spacer--bottom"
          aria-hidden="true"
        />
      </div>
    )
  }

  if (!draft) return null

  /* ——— BAG count setup: same shell as ROUND setup ——— */
  if (draft.phase === 'select-bags') {
    return (
      <DuelConfigShell
        roundCurrent={draft.roundNumber}
        roundTotal={session.totalRounds}
        hint={t.duelBagsHint}
        stepper={
          <NumberStepper
            label={t.duelBagsLabel}
            value={draft.bagsDraft}
            min={DUEL_BAGS_MIN}
            max={DUEL_BAGS_MAX}
            onChange={onBagsChange}
            valueAriaLabel={`${t.duelBagsLabel} ${draft.bagsDraft}`}
          />
        }
        primary={
          <button
            type="button"
            className="duel-btn duel-btn--primary"
            data-duel-metric="primary"
            onClick={onSetBags}
          >
            {t.duelSet}
          </button>
        }
        secondary={
          <button
            type="button"
            className="duel-btn"
            data-duel-metric="secondary"
            onClick={onBackFromBags}
          >
            {t.duelBack}
          </button>
        }
      />
    )
  }

  /* ——— Place bomb / coins / ready: BagBoard hero → instruction → buttons ——— */
  const showBoard = draft.bagsSet && draft.bagCount != null
  const isFinalRound = draft.roundNumber === session.totalRounds
  const advanceEnabled = isFinalRound ? canComplete(session) : canNextRound(session)

  return (
    <div className="duel-flow duel-flow--place">
      <div className="duel-slot duel-slot-round" data-duel-slot="round">
        <DuelRoundIndex
          current={draft.roundNumber}
          total={session.totalRounds}
        />
      </div>

      <div className="duel-slot duel-slot-board" data-duel-slot="board">
        {showBoard && draft.bagCount != null ? (
          <BagBoard bagCount={draft.bagCount} onBagTap={onBagTap}>
            <DuelPlacementOverlay
              bagCount={draft.bagCount}
              bombBagId={draft.bombBagId}
              coinCountsByBag={draft.coinCountsByBag}
            />
          </BagBoard>
        ) : (
          <div className="duel-bag-placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="duel-slot duel-slot-instruction" data-duel-slot="instruction">
        {placeCopy.instruction ? (
          <p className="duel-instruction" data-duel-metric="place-instruction">
            {withDuelNumsAndBreaks(placeCopy.instruction)}
          </p>
        ) : null}
      </div>

      {/* Keeps instruction near BagBoard while buttons sit on setup Y. */}
      <div className="duel-setup-spacer duel-setup-spacer--mid" aria-hidden="true" />

      <div className="duel-slot duel-slot-buttons" data-duel-slot="buttons">
        <div className="duel-btn-stack">
          <button
            type="button"
            className="duel-btn"
            data-duel-metric="place-reset"
            onClick={onResetRound}
          >
            {t.duelResetRound}
          </button>
          {isFinalRound ? (
            <button
              type="button"
              className="duel-btn duel-btn--primary"
              data-duel-metric="place-advance"
              disabled={!advanceEnabled}
              onClick={onComplete}
            >
              {t.duelComplete}
            </button>
          ) : (
            <button
              type="button"
              className="duel-btn duel-btn--primary"
              data-duel-metric="place-advance"
              disabled={!advanceEnabled}
              onClick={onNextRound}
            >
              {t.duelNextRound}
            </button>
          )}
          <button
            type="button"
            className="duel-btn"
            data-duel-metric="place-back"
            onClick={onBackFromPlace}
          >
            {t.duelBack}
          </button>
        </div>
      </div>

      <div className="duel-setup-spacer duel-setup-spacer--bottom" aria-hidden="true" />
    </div>
  )
}
