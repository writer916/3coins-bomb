import { validateDailyChallengeDate } from './dailyChallengeDate'
import { dailyChallengePeriod } from './dailyTime'

export type DailyRankingFinalTimeLocale = 'ja' | 'en'

export type DailyRankingFinalTimeOptions = {
  /** Test seam. Omit to use the browser's resolved IANA time zone. */
  readonly timeZone?: string | null
  /** Minutes east of UTC, used only when the IANA zone/name is unavailable. */
  readonly fallbackOffsetMinutes?: number
}

export type DailyChallengePeriodDisplay = {
  readonly timeZoneName: string
  readonly startsAt: string
  readonly endsAt: string
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

type LocalInstantParts = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly timeZoneName: string
}

function fallbackParts(
  instant: Date,
  offsetMinutesValue: number,
): LocalInstantParts {
  const offsetMinutes = Number.isFinite(offsetMinutesValue)
    ? Math.trunc(offsetMinutesValue)
    : 0
  const local = new Date(instant.getTime() + offsetMinutes * 60_000)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    timeZoneName: offsetLabel(offsetMinutes),
  }
}

function localInstantParts(
  instant: Date,
  locale: DailyRankingFinalTimeLocale,
  timeZone: string,
): LocalInstantParts {
  const short = partsRecord(locale, instant, timeZone, 'short')
  const long = partsRecord(locale, instant, timeZone, 'long')
  const year = Number(long.year)
  const month = Number(long.month)
  const day = Number(long.day)
  const hour = Number(long.hour)
  const minute = Number(long.minute)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offsetMinutes = Math.round((localAsUtc - instant.getTime()) / 60_000)

  if (timeZone === 'Asia/Tokyo') {
    return {
      year,
      month,
      day,
      hour,
      minute,
      timeZoneName: locale === 'ja' ? '日本時間' : 'JST',
    }
  }

  const shortName = short.timeZoneName ?? ''
  const longName = long.timeZoneName ?? ''
  const namedShort = shortName && !/^(?:GMT|UTC)(?:[+-]|$)/i.test(shortName)
  const candidate = locale === 'en' && namedShort ? shortName : longName
  return {
    year,
    month,
    day,
    hour,
    minute,
    timeZoneName:
      candidate && !/^(?:GMT|UTC)(?:[+-]|$)/i.test(candidate)
        ? candidate
        : offsetLabel(offsetMinutes),
  }
}

function formatPeriodEndpoint(
  value: LocalInstantParts,
  locale: DailyRankingFinalTimeLocale,
  includeYear: boolean,
): string {
  const time = `${value.hour}:${String(value.minute).padStart(2, '0')}`
  if (locale === 'ja') {
    const date = `${value.month}月${value.day}日`
    return `${includeYear ? `${value.year}年` : ''}${date} ${time}`
  }
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const date = `${months[value.month - 1] ?? ''} ${value.day}`
  return `${date}${includeYear ? `, ${value.year}` : ''} ${time}`
}

/** Formats the exact UTC challenge interval for the user's local time zone. */
export function formatDailyChallengePeriodDisplay(
  challengeDate: unknown,
  locale: DailyRankingFinalTimeLocale,
  options: DailyRankingFinalTimeOptions = {},
): DailyChallengePeriodDisplay {
  const period = dailyChallengePeriod(challengeDate)
  const start = new Date(period.startsAtMs)
  const end = new Date(period.endsAtMs)
  const timeZone =
    options.timeZone === undefined ? browserTimeZone() : options.timeZone
  const fallbackOffset = options.fallbackOffsetMinutes ?? -start.getTimezoneOffset()

  let startParts: LocalInstantParts
  let endParts: LocalInstantParts
  if (timeZone) {
    try {
      startParts = localInstantParts(start, locale, timeZone)
      endParts = localInstantParts(end, locale, timeZone)
    } catch {
      startParts = fallbackParts(start, fallbackOffset)
      endParts = fallbackParts(end, fallbackOffset)
    }
  } else {
    startParts = fallbackParts(start, fallbackOffset)
    endParts = fallbackParts(end, fallbackOffset)
  }

  const includeYear = startParts.year !== endParts.year
  const timeZoneName =
    startParts.timeZoneName === endParts.timeZoneName
      ? startParts.timeZoneName
      : `${startParts.timeZoneName}/${endParts.timeZoneName}`
  return {
    timeZoneName,
    startsAt: formatPeriodEndpoint(startParts, locale, includeYear),
    endsAt: formatPeriodEndpoint(endParts, locale, includeYear),
  }
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
    const parts = localInstantParts(instant, locale, timeZone)
    const time = `${parts.hour}:${String(parts.minute).padStart(2, '0')}`
    const localLabel =
      locale === 'ja'
        ? `${parts.timeZoneName}${time}`
        : `${time} ${parts.timeZoneName}`
    return localLabel
  } catch {
    return fallbackLabel(instant, locale, fallbackOffset)
  }
}
