/**
 * SOUND ON/OFF preference.
 * SFX (e.g. coin chime) should gate on `isSoundEnabled()` / caller-passed flag.
 */

export const SOUND_STORAGE_KEY = '3cb.soundEnabled'

/** Default for first visit / missing / invalid storage. */
export const DEFAULT_SOUND_ENABLED = true

/**
 * Parse a stored raw value. Invalid / unknown → default ON.
 * Does not throw.
 */
export function parseSoundStored(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return DEFAULT_SOUND_ENABLED
  const v = raw.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'off') return false
  return DEFAULT_SOUND_ENABLED
}

export function readSoundEnabled(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): boolean {
  if (!storage) return DEFAULT_SOUND_ENABLED
  try {
    return parseSoundStored(storage.getItem(SOUND_STORAGE_KEY))
  } catch {
    return DEFAULT_SOUND_ENABLED
  }
}

export function writeSoundEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | null | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Quota / private mode — preference stays in-memory only.
  }
}

/** Gate for future audio. Safe even when storage is unavailable. */
export function isSoundEnabled(
  storage: Pick<Storage, 'getItem'> | null | undefined = defaultStorage(),
): boolean {
  return readSoundEnabled(storage)
}

function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}
