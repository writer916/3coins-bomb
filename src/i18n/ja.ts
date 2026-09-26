import type { AppStrings } from './types'

export const ja: AppStrings = {
  brandTitle: '3 COINS BOMB',
  brandTagline: '3 COINS. 1 BOMB.',
  topBlurb: '',
  bagsMeta: (count) => `${count}袋`,
  newRound: '新しいROUND',
  cashOut: 'ここで降りる',
  provisionalCoins: (count) => `COINS ${count}`,
  resultEmpty: 'EMPTY',
  resultBomb: 'BOMB',
  resultCoin: (count) => `COIN ×${count}`,
  roundActive: 'ROUND',
  roundCashedOut: 'ここで降りた',
  roundCleared: 'ROUND CLEAR',
  roundBombed: 'BOMB',
  capturedCoins: (count) => `${count} COINS`,
  dash: '—',
}
