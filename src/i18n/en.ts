import type { AppStrings } from './types'

export const en: AppStrings = {
  brandTitle: '3 COINS BOMB',
  brandTagline: '3 COINS. 1 BOMB.',
  topBlurb: '',
  bagsMeta: (count) => `${count} bags`,
  newRound: 'New ROUND',
  reveal: 'REVEAL',
  nextRound: 'NEXT ROUND →',
  cashOut: 'CASH OUT',
  provisionalCoins: (count) => `COINS ${count}`,
  resultEmpty: 'EMPTY',
  resultBomb: 'BOMB',
  resultCoin: (count) => `COIN ×${count}`,
  roundActive: 'ROUND',
  roundCashedOut: 'CASH OUT',
  roundCleared: 'ROUND CLEAR',
  roundBombed: 'BOMB',
  capturedCoins: (count) => `${count} COINS`,
  dash: '—',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
}
