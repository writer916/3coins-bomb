export type LocaleId = 'en' | 'ja'

export type AppStrings = {
  brandTitle: string
  brandTagline: string
  /** Reserved for future top-page rules blurb (multi-locale). */
  topBlurb: string
  bagsMeta: (count: number) => string
  newRound: string
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
}
