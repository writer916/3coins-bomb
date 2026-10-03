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
  duelLockError: string
  duelJoining: string
  duelJoined: string
  duelJoinError: string
  duelCreatorInviteOpened: string
  duelPlacementsLocked: string
  duelInviteUrlLabel: string
  duelInviteOpponentIntro: string
  duelInviteNext: string
  duelSelfUrlLabel: string
  duelSelfUrlIntro: string
  duelReturnToTop: string
  duelInviteCopy: string
  duelInviteCopied: string
  duelInviteCopyFailed: string
  duelInviteShare: string
  duelInviteShareFailed: string
  duelInviteQr: string
  duelInviteQrClose: string
  duelInviteOpponentJoined: string
  duelPlayLoading: string
  duelPlayError: string
  duelOpenRetry: string
  duelResult: string
  duelWaitingTitle: string
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
  duelBack: string
  duelRoundProgress: (current: number, total: number) => string
  /** Complete-screen summary — fixed copy, not ROUND-count dependent. */
  duelRoundsReady: string
  duelStartOverConfirm: string
  duelBackConfirm: string
}
