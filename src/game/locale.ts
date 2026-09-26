import type { LocaleId } from '../i18n/types'
import { DEFAULT_LOCALE } from '../i18n'

/**
 * UI language preference (English-first product).
 * Invalid / missing → DEFAULT_LOCALE (en).
 */

export const LANGUAGE_STORAGE_KEY = '3cb.language'

export function parseLocaleStored(
  raw: string | null | undefined,
): LocaleId {
  if (raw === null || raw === undefined) return DEFAULT_LOCALE
  const v = raw.trim().toLowerCase()
  if (v === 'en' || v === 'ja') return v
  return DEFAULT_LOCALE
}

export function readLocale(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): LocaleId {
  if (!storage) return DEFAULT_LOCALE
  try {
    return parseLocaleStored(storage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE
  }
}

export function writeLocale(
  locale: LocaleId,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, locale)
  } catch {
    // Quota / private mode — preference stays in-memory only.
  }
}

/** Toggle EN ↔ JA. */
export function nextLocale(locale: LocaleId): LocaleId {
  return locale === 'en' ? 'ja' : 'en'
}

function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}
