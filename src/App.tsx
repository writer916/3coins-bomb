import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BagBoard } from './components/BagBoard'
import { BombOpenFx } from './components/BombOpenFx'
import { CoinOpenFx } from './components/CoinOpenFx'
import { EmptyOpenFx } from './components/EmptyOpenFx'
import { LanguageToggle } from './components/LanguageToggle'
import { ModeSelect, type PlayMode } from './components/ModeSelect'
import { DuelFlow } from './components/DuelFlow'
import { RevealBoard } from './components/RevealBoard'
import { SoundToggle } from './components/SoundToggle'
import type { BagId } from './game/assets'
import { unlockCoinAudio } from './game/coinAudio'
import { playBagOpen, warmBagOpenAudio } from './game/bagAudio'
import { resolveBagOpenSeRequest } from './game/bagSfx'
import {
  visualHiddenBagIds,
  type CoinFxSample,
  type FxCoinCount,
} from './game/coinFx'
import { bagsForCount } from './game/formations'
import type { BagContents, HiddenHand } from './game/hand'
import { nextLocale, readLocale, writeLocale } from './game/locale'
import { openedBagIds } from './game/open'
import {
  buildRevealPlan,
  canRequestReveal,
  canShowEndActions,
} from './game/reveal'
import {
  applyOpenBag,
  canCashOut,
  createActiveRound,
  isRoundActive,
  tryCashOut,
  type RoundState,
} from './game/round'
import { readSoundEnabled, writeSoundEnabled } from './game/sound'
import {
  applyAcceptedOpenToDraft,
  commitRoundResultToStats,
  createInitialSoloRoundDraft,
  readSoloStats,
  resetSoloRoundDraft,
  resetSoloStats,
  writeSoloStats,
  type SoloRoundDraft,
  type SoloRoundResult,
  type SoloStats,
} from './game/soloStats'
import { getStrings, type LocaleId } from './i18n'
import './App.css'

type AppScreen = 'top' | 'solo' | 'coming' | 'duel'

type DevRoundApi = {
  getRound: () => RoundState
  startWithHand: (hand: HiddenHand) => void
  newRound: () => void
  /** DEV: jump to FULL REVEAL for a fixed hand (no FX / no SE). */
  previewFullReveal: (hand: HiddenHand) => void
  getRevealed: () => boolean
  getSoloStats: () => SoloStats
  getSoloRoundDraft: () => SoloRoundDraft
}

type ActiveCoinFx = {
  bagId: BagId
  coinCount: FxCoinCount
  /** This open caused phase=cleared (3 COINS). */
  clearsRound: boolean
  runId: number
}

type ActiveBombFx = {
  bagId: BagId
  runId: number
}

type ActiveEmptyFx = {
  bagId: BagId
  runId: number
}

declare global {
  interface Window {
    __3cbDev?: DevRoundApi
  }
}

function soloResultFromEndedRound(state: RoundState): SoloRoundResult | null {
  if (state.phase === 'bombed') return { kind: 'bombed' }
  if (state.phase === 'cleared') return { kind: 'cleared' }
  if (state.phase === 'cashed-out') {
    const n = state.capturedCoins
    if (n === 1 || n === 2) return { kind: 'cashed-out', capturedCoins: n }
  }
  return null
}

function App() {
  const [screen, setScreen] = useState<AppScreen>('top')
  const [comingMode, setComingMode] = useState<PlayMode | null>(null)
  const [locale, setLocale] = useState<LocaleId>(() => readLocale())
  const t = getStrings(locale)
  const [round, setRound] = useState<RoundState>(() => createActiveRound())
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled())
  const [soloStats, setSoloStats] = useState<SoloStats>(() => readSoloStats())
  /** In-progress ROUND bag tallies — memory only, never localStorage. */
  const [soloRoundDraft, setSoloRoundDraft] = useState<SoloRoundDraft>(() =>
    createInitialSoloRoundDraft(),
  )
  const [coinFx, setCoinFx] = useState<ActiveCoinFx | null>(null)
  const [bombFx, setBombFx] = useState<ActiveBombFx | null>(null)
  const [emptyFx, setEmptyFx] = useState<ActiveEmptyFx | null>(null)
  const [fxSample, setFxSample] = useState<CoinFxSample | null>(null)
  /** FULL REVEAL toggled after ROUND end (optional). */
  const [revealed, setRevealed] = useState(false)
  /** Sync guard so double-taps before re-render cannot open twice. */
  const openedGuardRef = useRef<Set<BagId>>(new Set())
  /** Short lock while open FX runs — prevents mixed bag origins. */
  const fxLockRef = useRef(false)
  const roundRef = useRef(round)
  const revealedRef = useRef(revealed)
  const soloStatsRef = useRef(soloStats)
  const soloRoundDraftRef = useRef(soloRoundDraft)
  /** One commit per settled ROUND — reset on NEXT / RESET / DEV start. */
  const roundStatsCommittedRef = useRef(false)
  const fxRunIdRef = useRef(0)
  const soundOnRef = useRef(soundOn)

  useEffect(() => {
    roundRef.current = round
  }, [round])

  useEffect(() => {
    revealedRef.current = revealed
  }, [revealed])

  useEffect(() => {
    soloStatsRef.current = soloStats
  }, [soloStats])

  useEffect(() => {
    soloRoundDraftRef.current = soloRoundDraft
  }, [soloRoundDraft])

  useEffect(() => {
    soundOnRef.current = soundOn
  }, [soundOn])

  const clearOpenFx = useCallback(() => {
    fxLockRef.current = false
    setCoinFx(null)
    setBombFx(null)
    setEmptyFx(null)
    setFxSample(null)
  }, [])

  const persistSoloStats = useCallback((next: SoloStats) => {
    soloStatsRef.current = next
    writeSoloStats(next)
    setSoloStats(next)
  }, [])

  const setDraft = useCallback((next: SoloRoundDraft) => {
    soloRoundDraftRef.current = next
    setSoloRoundDraft(next)
  }, [])

  /**
   * Accepted open → ROUND draft only. If ROUND just settled, fold draft
   * into cumulative stats once and persist settled data only.
   */
  const recordOpenAndMaybeCommit = useCallback(
    (contents: BagContents, nextRound: RoundState) => {
      const nextDraft = applyAcceptedOpenToDraft(soloRoundDraftRef.current, contents)
      soloRoundDraftRef.current = nextDraft
      setSoloRoundDraft(nextDraft)

      if (nextRound.phase === 'active' || roundStatsCommittedRef.current) return

      const result = soloResultFromEndedRound(nextRound)
      if (!result) return
      const committed = commitRoundResultToStats(
        soloStatsRef.current,
        nextDraft,
        result,
        false,
      )
      if (!committed.ok) return
      roundStatsCommittedRef.current = true
      persistSoloStats(committed.stats)
    },
    [persistSoloStats],
  )

  const commitEndedRoundOnce = useCallback(
    (ended: RoundState) => {
      if (ended.phase === 'active' || roundStatsCommittedRef.current) return
      const result = soloResultFromEndedRound(ended)
      if (!result) return
      const committed = commitRoundResultToStats(
        soloStatsRef.current,
        soloRoundDraftRef.current,
        result,
        false,
      )
      if (!committed.ok) return
      roundStatsCommittedRef.current = true
      persistSoloStats(committed.stats)
    },
    [persistSoloStats],
  )

  const beginFreshRound = useCallback(
    (hand?: HiddenHand) => {
      openedGuardRef.current = new Set()
      clearOpenFx()
      setRevealed(false)
      roundStatsCommittedRef.current = false
      setDraft(resetSoloRoundDraft())
      setRound(createActiveRound(hand))
    },
    [clearOpenFx, setDraft],
  )

  const opened = useMemo(() => openedBagIds(round.history), [round.history])

  const allBagIds = useMemo(
    () => new Set(bagsForCount(round.hand.bagCount)),
    [round.hand.bagCount],
  )

  const hiddenBagIds = useMemo(() => {
    // FULL REVEAL: every bag image gone — contents overlay only.
    if (revealed) return allBagIds

    // BOMB / EMPTY: bag gone immediately (opened already includes bagId).
    if (bombFx || emptyFx) return opened

    if (!coinFx) return opened
    if (fxSample && fxSample.bagId === coinFx.bagId) {
      return visualHiddenBagIds(opened, fxSample)
    }
    // COIN FX scheduled but first sample not yet applied — keep bag briefly.
    const next = new Set(opened)
    next.delete(coinFx.bagId)
    return next
  }, [revealed, allBagIds, opened, coinFx, bombFx, emptyFx, fxSample])

  const openFxActive = coinFx !== null || bombFx !== null || emptyFx !== null
  const showEndActions = canShowEndActions(round.phase, openFxActive)
  const showRevealBtn = canRequestReveal(round.phase, openFxActive, revealed)

  const revealPlan = useMemo(
    () => (revealed ? buildRevealPlan(round.hand, round.history) : null),
    [revealed, round.hand, round.history],
  )

  const handleBagTap = useCallback(
    (bagId: BagId) => {
      if (fxLockRef.current) return
      if (openedGuardRef.current.has(bagId)) return

      // Unlock + async warm (coin + bag preload). Do NOT sync-load bag here —
      // load() immediately before playBagOpen races and stalls currentTime.
      unlockCoinAudio()

      const prev = roundRef.current
      if (!isRoundActive(prev)) return

      const result = applyOpenBag(prev, bagId)
      if (!result.ok) return

      openedGuardRef.current.add(bagId)
      setRound(result.state)
      recordOpenAndMaybeCommit(result.reveal.contents, result.state)

      const bagSe = resolveBagOpenSeRequest(soundOnRef.current, true)
      if (bagSe.play) {
        playBagOpen({ soundEnabled: true })
      }

      const contents = result.reveal.contents
      if (contents.kind === 'coins') {
        fxLockRef.current = true
        fxRunIdRef.current += 1
        setFxSample(null)
        setBombFx(null)
        setEmptyFx(null)
        setCoinFx({
          bagId,
          coinCount: contents.coinCount,
          clearsRound: result.state.phase === 'cleared',
          runId: fxRunIdRef.current,
        })
      } else if (contents.kind === 'bomb') {
        fxLockRef.current = true
        fxRunIdRef.current += 1
        setFxSample(null)
        setCoinFx(null)
        setEmptyFx(null)
        setBombFx({
          bagId,
          runId: fxRunIdRef.current,
        })
      } else if (contents.kind === 'empty') {
        fxLockRef.current = true
        fxRunIdRef.current += 1
        setFxSample(null)
        setCoinFx(null)
        setBombFx(null)
        setEmptyFx({
          bagId,
          runId: fxRunIdRef.current,
        })
      }
    },
    [recordOpenAndMaybeCommit],
  )

  const handleCashOut = useCallback(() => {
    const prev = roundRef.current
    const result = tryCashOut(prev)
    if (!result.ok) return
    setRound(result.state)
    commitEndedRoundOnce(result.state)
  }, [commitEndedRoundOnce])

  const handleNewRound = useCallback(() => {
    beginFreshRound()
  }, [beginFreshRound])

  const handleReset = useCallback(() => {
    if (!window.confirm(t.resetConfirm)) return
    persistSoloStats(resetSoloStats())
    setDraft(resetSoloRoundDraft())
    beginFreshRound()
  }, [t.resetConfirm, persistSoloStats, setDraft, beginFreshRound])

  const handleReveal = useCallback(() => {
    if (!canRequestReveal(roundRef.current.phase, fxLockRef.current, revealedRef.current)) {
      return
    }
    // Instant, silent — no SE / no FX / no stats change.
    setRevealed(true)
  }, [])

  const handleSoundToggle = useCallback(() => {
    unlockCoinAudio()
    warmBagOpenAudio()
    setSoundOn((prev) => {
      const next = !prev
      writeSoundEnabled(next)
      return next
    })
  }, [])

  const handleLanguageToggle = useCallback(() => {
    setLocale((prev) => {
      const next = nextLocale(prev)
      writeLocale(next)
      return next
    })
  }, [])

  const goTop = useCallback(() => {
    setComingMode(null)
    setScreen('top')
  }, [])

  const handleModeSelect = useCallback((mode: PlayMode) => {
    if (mode === 'solo') {
      setComingMode(null)
      setScreen('solo')
      return
    }
    if (mode === 'duel') {
      setComingMode(null)
      setScreen('duel')
      return
    }
    setComingMode(mode)
    setScreen('coming')
  }, [])

  const handleCoinFxSample = useCallback((sample: CoinFxSample) => {
    setFxSample(sample)
  }, [])

  const handleCoinFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  const handleBombFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  const handleEmptyFxComplete = useCallback(() => {
    clearOpenFx()
  }, [clearOpenFx])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__3cbDev = {
      getRound: () => roundRef.current,
      getRevealed: () => revealedRef.current,
      getSoloStats: () => soloStatsRef.current,
      getSoloRoundDraft: () => soloRoundDraftRef.current,
      startWithHand: (hand) => {
        beginFreshRound(hand)
      },
      newRound: () => {
        beginFreshRound()
      },
      previewFullReveal: (hand) => {
        openedGuardRef.current = new Set()
        clearOpenFx()
        // Settled cashed-out shell so end actions / reveal UI appear without FX.
        // Does NOT commit solo stats (DEV preview only).
        roundStatsCommittedRef.current = true
        setDraft(resetSoloRoundDraft())
        setRound({
          hand,
          history: [],
          lastReveal: null,
          phase: 'cashed-out',
          provisionalCoins: 1,
          capturedCoins: 1,
        })
        setRevealed(true)
      },
    }
    return () => {
      delete window.__3cbDev
    }
  }, [clearOpenFx, beginFreshRound, setDraft])

  // ROUND already ended on bomb; also block while any open FX runs.
  const canTapBags = isRoundActive(round) && !coinFx && !bombFx && !emptyFx
  const showCashOut = canCashOut(round) && !showEndActions

  // Georgia oldstyle "3" sits optically lower than caps — split for micro lift.
  const brandTitleMatch = /^(\d)(\s.+)$/.exec(t.brandTitle)

  const brandTitleNode = brandTitleMatch ? (
    <>
      <span className="brand-title-digit">{brandTitleMatch[1]}</span>
      <span className="brand-title-rest">{brandTitleMatch[2]}</span>
    </>
  ) : (
    t.brandTitle
  )

  const topControls = (
    <div className="app-topbar">
      <LanguageToggle
        ariaLabel={`${t.languageToggle} (${locale.toUpperCase()})`}
        title={t.languageToggleHint}
        onToggle={handleLanguageToggle}
      />
      <SoundToggle
        enabled={soundOn}
        onToggle={handleSoundToggle}
        labelOn={t.soundOn}
        labelOff={t.soundOff}
      />
    </div>
  )

  if (screen === 'top') {
    return (
      <main className="app app--top">
        <div className="field-header">
          {topControls}
          <header className="app-header">
            <h1 className="brand-title" aria-label={t.brandTitle}>
              {brandTitleNode}
            </h1>
          </header>
        </div>
        <ModeSelect t={t} onSelect={handleModeSelect} />
      </main>
    )
  }

  if (screen === 'coming') {
    const modeName =
      comingMode === 'group' ? t.modeGroupName : ''
    return (
      <main className="app app--coming">
        <div className="field-header">
          {topControls}
          <header className="app-header">
            <button
              type="button"
              className="brand-title brand-title--link"
              aria-label={t.backToTop}
              title={t.backToTop}
              onClick={goTop}
            >
              {brandTitleNode}
            </button>
          </header>
        </div>
        <div className="coming-soon">
          {modeName ? <p className="coming-soon-mode">{modeName}</p> : null}
          <p className="coming-soon-label">{t.comingSoon}</p>
        </div>
      </main>
    )
  }

  if (screen === 'duel') {
    return (
      <main className="app app--duel">
        <div className="field-header">
          {topControls}
          <header className="app-header">
            <h1
              className="brand-title duel-setup-heading"
              aria-label={t.modeDuelName}
            >
              {t.modeDuelName}
            </h1>
          </header>
        </div>
        <DuelFlow t={t} onGoTop={goTop} />
      </main>
    )
  }

  return (
    <main className="app">
      {/* GROUP A: BRAND — title (→ TOP) + LANGUAGE + SOUND */}
      <div className="field-header">
        {topControls}

        <header className="app-header">
          <button
            type="button"
            className="brand-title brand-title--link"
            aria-label={t.backToTop}
            title={t.backToTop}
            onClick={goTop}
          >
            {brandTitleNode}
          </button>
        </header>
      </div>

      {/* GROUP B: CURRENT ROUND — bags + round actions */}
      <div className="group-round">
        <div className="field-bag">
          <BagBoard
            bagCount={round.hand.bagCount}
            hiddenBagIds={hiddenBagIds}
            onBagTap={canTapBags ? handleBagTap : undefined}
          >
            {revealPlan ? <RevealBoard plan={revealPlan} /> : null}
            {coinFx ? (
              <CoinOpenFx
                key={`coin-${coinFx.runId}`}
                bagId={coinFx.bagId}
                bagCount={round.hand.bagCount}
                coinCount={coinFx.coinCount}
                clearsRound={coinFx.clearsRound}
                soundEnabled={soundOn}
                onSample={handleCoinFxSample}
                onComplete={handleCoinFxComplete}
              />
            ) : null}
            {bombFx ? (
              <BombOpenFx
                key={`bomb-${bombFx.runId}`}
                bagId={bombFx.bagId}
                bagCount={round.hand.bagCount}
                hiddenBagIds={hiddenBagIds}
                soundEnabled={soundOn}
                onComplete={handleBombFxComplete}
              />
            ) : null}
            {emptyFx ? (
              <EmptyOpenFx
                key={`empty-${emptyFx.runId}`}
                bagId={emptyFx.bagId}
                bagCount={round.hand.bagCount}
                onComplete={handleEmptyFxComplete}
              />
            ) : null}
          </BagBoard>
        </div>

        {/* Fixed height: empty / CASH OUT / REVEAL+NEXT */}
        <div className="field-action" aria-live="polite">
          {showCashOut ? (
            <button type="button" className="dev-btn cash-out-btn" onClick={handleCashOut}>
              {t.cashOut}
            </button>
          ) : null}
          {showEndActions ? (
            <div className="end-actions">
              <div className="end-action-slot">
                {showRevealBtn ? (
                  <button
                    type="button"
                    className="dev-btn end-action-btn"
                    onClick={handleReveal}
                  >
                    {t.reveal}
                  </button>
                ) : null}
              </div>
              <div className="end-action-slot">
                <button
                  type="button"
                  className="dev-btn end-action-btn"
                  onClick={handleNewRound}
                >
                  {t.nextRound}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* GROUP C: SESSION SCORE — one flex row (ROUNDS / COINS / RESET) fits viewport */}
      <div className="group-session" aria-live="polite">
        <div className="score-row">
          <p className="score-item">
            <span className="score-label">{t.soloRoundsLabel}</span>
            <span className="score-num">{soloStats.rounds}</span>
          </p>
          <p className="score-item">
            <span className="score-label">{t.soloCoinsLabel}</span>
            <span className="score-num">{soloStats.capturedCoins}</span>
          </p>
          <button type="button" className="reset-btn" onClick={handleReset}>
            {t.reset}
          </button>
        </div>
      </div>
    </main>
  )
}

export default App
