import { en } from './en'
import { ja } from './ja'
import type { AppStrings, LocaleId } from './types'

const catalogs: Record<LocaleId, AppStrings> = {
  en,
  ja,
}

/** Default UI locale (English as primary game UI language). */
export const DEFAULT_LOCALE: LocaleId = 'en'

export function getStrings(locale: LocaleId = DEFAULT_LOCALE): AppStrings {
  return catalogs[locale] ?? catalogs.en
}

export type { AppStrings, LocaleId }
export { en, ja }
