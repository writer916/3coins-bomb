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
  /** Cumulative settled ROUND count (solo). */
  soloRounds: (count: number) => string
  /** Cumulative captured COINS (solo). */
  soloCoins: (count: number) => string
  reset: string
  resetConfirm: string
}
