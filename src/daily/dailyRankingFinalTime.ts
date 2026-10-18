import { validateDailyChallengeDate } from './dailyChallengeDate'

export type DailyRankingFinalTimeLocale = 'ja' | 'en'

export type DailyRankingFinalTimeOptions = {
  /** Test seam. Omit to use the browser's resolved IANA time zone. */
  readonly timeZone?: string | null
  /** Minutes east of UTC, used only when the IANA zone/name is unavailable. */
  readonly fallbackOffsetMinutes?: number
}

const MS_PER_DAY = 86_400_000

function finalInstant(challengeDateValue: unknown): Date {
  const challengeDate = validateDailyChallengeDate(challengeDateValue)
  return new Date(Date.parse(`${challengeDate}T00:00:00.000Z`) + MS_PER_DAY)
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

function partsRecord(
  locale: DailyRankingFinalTimeLocale,
  instant: Date,
  timeZone: string,
  timeZoneName?: 'short' | 'long',
): Record<string, string> {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName,
  }).formatToParts(instant)
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]))
}

function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

function fallbackLabel(
  instant: Date,
  locale: DailyRankingFinalTimeLocale,
  offsetMinutes: number,
): string {
  const safeOffset = Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : 0
  const local = new Date(instant.getTime() + safeOffset * 60_000)
  const hour = local.getUTCHours()
  const minute = String(local.getUTCMinutes()).padStart(2, '0')
  const time = `${hour}:${minute}`
  return locale === 'ja'
    ? `${offsetLabel(safeOffset)} ${time}`
    : `${time} ${offsetLabel(safeOffset)}`
}

/** Formats the UTC close of a DAILY challenge for the user's local time zone. */
export function formatDailyRankingFinalTime(
  challengeDate: unknown,
  locale: DailyRankingFinalTimeLocale,
  options: DailyRankingFinalTimeOptions = {},
): string {
  const instant = finalInstant(challengeDate)
  const timeZone =
    options.timeZone === undefined ? browserTimeZone() : options.timeZone
  const fallbackOffset =
    options.fallbackOffsetMinutes ?? -instant.getTimezoneOffset()

  if (!timeZone) return fallbackLabel(instant, locale, fallbackOffset)

  try {
    const short = partsRecord(locale, instant, timeZone, 'short')
    const long = partsRecord(locale, instant, timeZone, 'long')
    const year = Number(long.year)
    const month = Number(long.month)
    const day = Number(long.day)
    const hour = Number(long.hour)
    const minute = Number(long.minute)
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
    const offsetMinutes = Math.round((localAsUtc - instant.getTime()) / 60_000)
    let zoneName: string
    if (timeZone === 'Asia/Tokyo') {
      zoneName = locale === 'ja' ? '日本時間' : 'JST'
    } else {
      const shortName = short.timeZoneName ?? ''
      const longName = long.timeZoneName ?? ''
      const namedShort = shortName && !/^(?:GMT|UTC)(?:[+-]|$)/i.test(shortName)
      const candidate = locale === 'en' && namedShort ? shortName : longName
      if (!candidate || /^(?:GMT|UTC)(?:[+-]|$)/i.test(candidate)) {
        return fallbackLabel(instant, locale, offsetMinutes)
      }
      zoneName = candidate
    }

    const time = `${hour}:${String(minute).padStart(2, '0')}`
    const localLabel = locale === 'ja' ? `${zoneName}${time}` : `${time} ${zoneName}`
    return localLabel
  } catch {
    return fallbackLabel(instant, locale, fallbackOffset)
  }
}
