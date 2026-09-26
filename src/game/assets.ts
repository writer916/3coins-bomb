/** Public URLs for approved 3CB game art. Do not rewrite or replace these files. */

export const GAME_ASSET_BASE = '/assets/game'
export const AUDIO_ASSET_BASE = '/assets/audio'

export const BAG_IDS = [
  'bag-1',
  'bag-2',
  'bag-3',
  'bag-4',
  'bag-5',
  'bag-6',
  'bag-7',
  'bag-8',
] as const

export type BagId = (typeof BAG_IDS)[number]

export const COIN_IDS = ['coin-1', 'coin-2', 'coin-3'] as const
export type CoinId = (typeof COIN_IDS)[number]

export const BOMB_IDS = ['bomb-off', 'bomb-on'] as const
export type BombId = (typeof BOMB_IDS)[number]

export function bagSrc(bagId: BagId): string {
  return `${GAME_ASSET_BASE}/${bagId}.webp`
}

export function coinSrc(coinId: CoinId): string {
  return `${GAME_ASSET_BASE}/${coinId}.webp`
}

export function bombSrc(bombId: BombId): string {
  return `${GAME_ASSET_BASE}/${bombId}.webp`
}

/** Shared COIN open chime (same file for ×1 / ×2 / ×3). */
export function coinChimeSrc(): string {
  return `${AUDIO_ASSET_BASE}/coin-chime.mp3`
}
