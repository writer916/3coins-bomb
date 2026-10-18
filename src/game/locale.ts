import type { LocaleId } from '../i18n/types'
import { DEFAULT_LOCALE } from '../i18n'

/**
 * UI language preference (English-first product).
 * Invalid / missing → DEFAULT_LOCALE (en).
 */

export const LANGUAGE_STORAGE_KEY = '3cb.language'

type BrowserLanguageSource = {
  readonly languages?: readonly unknown[]
  readonly language?: unknown
}

function parseExplicitLocale(raw: unknown): LocaleId | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return value === 'en' || value === 'ja' ? value : null
}

export function parseLocaleStored(
  raw: string | null | undefined,
): LocaleId {
  return parseExplicitLocale(raw) ?? DEFAULT_LOCALE
}

/** Browser preference is only a default; it is never persisted here. */
export function localeFromBrowserLanguages(
  source: BrowserLanguageSource | null | undefined = defaultBrowserLanguages(),
): LocaleId {
  if (!source) return DEFAULT_LOCALE
  try {
    const first = Array.isArray(source.languages) ? source.languages[0] : undefined
    const candidate =
      typeof first === 'string' && first.trim()
        ? first
        : typeof source.language === 'string'
          ? source.language
          : ''
    return /^ja(?:-|$)/i.test(candidate.trim()) ? 'ja' : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export function readLocale(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
  browserLanguages: BrowserLanguageSource | null | undefined = defaultBrowserLanguages(),
): LocaleId {
  if (storage) {
    try {
      const stored = parseExplicitLocale(storage.getItem(LANGUAGE_STORAGE_KEY))
      if (stored) return stored
    } catch {
      // Storage may be unavailable in private/restricted contexts.
    }
  }
  return localeFromBrowserLanguages(browserLanguages)
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

function defaultBrowserLanguages(): BrowserLanguageSource | null {
  try {
    if (typeof navigator === 'undefined') return null
    return navigator
  } catch {
    return null
  }
}
