/** UTC calendar date key for DAILY CHALLENGE (`YYYY-MM-DD`). */
export type DailyChallengeDate = string

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Validates a UTC challenge date key. Rejects local-only formats and
 * non-canonical calendar dates (e.g. `2026-02-30`).
 */
export function validateDailyChallengeDate(value: unknown): DailyChallengeDate {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error('Invalid DAILY challenge date.')
  }
  const match = DATE_PATTERN.exec(value)
  if (!match) throw new Error('Invalid DAILY challenge date.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error('Invalid DAILY challenge date.')
  }
  return value
}

/** Resolves the UTC calendar date for `now` (default: current instant). */
export function utcDailyChallengeDate(now: Date = new Date()): DailyChallengeDate {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid timestamp for DAILY challenge date.')
  }
  return validateDailyChallengeDate(now.toISOString().slice(0, 10))
}
