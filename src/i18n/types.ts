export type LocaleId = 'en' | 'ja'

export type AppStrings = {
  brandTitle: string
  brandTagline: string
  /** Reserved for future top-page rules blurb (multi-locale). */
  topBlurb: string
  bagsMeta: (count: number) => string
  newRound: string
  /** End-of-ROUND optional full-hand answer. */
  reveal: string
  /** End-of-ROUND primary advance (same flow as newRound for solo). */
  nextRound: string
  cashOut: string
  provisionalCoins: (count: number) => string
  resultEmpty: string
  resultBomb: string
  resultCoin: (count: number) => string
  roundActive: string
  roundCashedOut: string
  roundCleared: string
  roundBombed: string
  capturedCoins: (count: number) => string
  dash: string
  soundOn: string
  soundOff: string
  /** Aria/title for language toggle control. */
  languageToggle: string
  languageToggleHint: string
  /** Label for cumulative settled ROUND count (solo). */
  soloRoundsLabel: string
  /** Label for cumulative captured COINS (solo). */
  soloCoinsLabel: string
  reset: string
  resetConfirm: string
  /** Mode select — brand names may stay EN across locales. */
  modeSoloName: string
  modeSoloDesc: string
  modeDuelName: string
  modeDuelDesc: string
  modeGroupName: string
  modeGroupDesc: string
  modeGroupBadge: string
  comingSoon: string
  groupRoundsHint: string
  groupRoundsLabel: string
  groupPlayersHint: string
  groupPlayersLabel: string
  groupContinue: string
  groupCreate: string
  groupCreating: string
  groupCreateError: string
  groupEntryReady: string
  groupEntryError: string
  groupNicknameLabel: string
  groupNicknamePlaceholder: string
  groupNicknameError: string
  groupJoin: string
  groupJoining: string
  groupJoinError: string
  groupParticipantReady: string
  groupPlayPreparing: string
  groupPlayReady: string
  groupPlayError: string
  groupRoundLabel: string
  /** Accessible name when brand title returns to mode select. */
  backToTop: string
  /** DUEL placement flow. */
  duelRoundsHint: string
  duelRoundsLabel: string
  duelContinue: string
  duelTop: string
  duelBagsHint: string
  duelBagsLabel: string
  duelSet: string
  duelPlaceBomb: string
  duelPlaceCoins: string
  duelReady: string
  duelResetRound: string
  duelNextRound: string
  duelComplete: string
  duelStartOver: string
  duelLock: string
  duelLocking: string
  /** TOP create+LOCK failure (match creation path). */
  duelLockError: string
  /** Existing-match placement LOCK failure (A resume / B). */
  duelPlacementLockError: string
  duelJoining: string
  duelJoined: string
  duelJoinError: string
  duelCreatorInviteOpened: string
  duelPlacementsLocked: string
  /** Wait: self locked / opponent unlocked (locale-invariant hierarchy). */
  duelWaitingForOpponentPlacement: string
  duelInviteUrlLabel: string
  duelInviteOpponentIntro: string
  duelInviteNext: string
  duelSelfUrlLabel: string
  duelSelfUrlIntro: string
  duelReturnToTop: string
  /** Final RESULT: promote adding 3CB itself to the home screen (not a match URL). */
  duelAddToHomeScreen: string
  duelAddToHomeGuideIos: string
  duelAddToHomeGuideAndroid: string
  duelAddToHomeGuideGeneric: string
  duelAddToHomeGuideClose: string
  duelInviteCopy: string
  /** Icon-only copy control label (accessibility). */
  duelInviteCopyAria: string
  duelInviteCopied: string
  duelInviteCopyFailed: string
  duelInviteShare: string
  duelInviteShareFailed: string
  duelInviteQr: string
  duelInviteQrClose: string
  duelInviteOpponentJoined: string
  /** Start-confirm: formatted match created_at (locale-specific). */
  duelMatchCreatedAt: (isoCreatedAt: string) => string
  /** Start-confirm: both placements locked. */
  duelStartConfirmReady: string
  duelStartConfirmRoundsLabel: string
  duelStartConfirmRoundsValue: (totalRounds: number) => string
  duelStartConfirmStart: string
  duelPlayLoading: string
  duelPlayError: string
  duelOpenRetry: string
  duelCashOutRetry: string
  duelResult: string
  /** Completion shell heading: self play finished (waiting + result-ready). */
  duelWaitingTitle: string
  /** Completion waiting body: opponent still playing. */
  duelWaitingBody: string
  duelCheckResult: string
  /** Post-completion: reveal RESULT only after explicit press. */
  duelViewResult: string
  duelWin: string
  duelLose: string
  duelDraw: string
  duelTotalCoins: string
  duelThreeCoinsComplete: string
  duelBombsHit: string
  /** Kept for shared/future modes; DUEL RESULT does not display this. */
  duelCoinBagHitRate: string
  duelYou: string
  duelOpponent: string
  duelResultError: string
  /** Final RESULT → completed match detail. */
  duelViewDetails: string
  duelMatchDetails: string
  duelBackToResult: string
  duelMatchDetailLoading: string
  duelMatchDetailError: string
  duelMatchDetailRetry: string
  duelMatchDetailRound: (roundNumber: number) => string
  duelBack: string
  duelRoundProgress: (current: number, total: number) => string
  /** Complete-screen summary — fixed copy, not ROUND-count dependent. */
  duelRoundsReady: string
  duelStartOverConfirm: string
  duelBackConfirm: string
}
