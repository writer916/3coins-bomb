/**
 * Format duel_matches.created_at (ISO) for start-confirm UI.
 * Both locales use Asia/Tokyo so JA/EN stay aligned with match creation time.
 */

function tokyoParts(isoCreatedAt: string): {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  dayPeriod: string
} | null {
  const date = new Date(isoCreatedAt)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  const dayPeriod = get('dayPeriod')
  if (!year || !month || !day || !hour || !minute || !dayPeriod) return null
  return { year, month, day, hour, minute, dayPeriod }
}

/** e.g. `2026年10月3日 23:00 作成` */
export function formatDuelMatchCreatedAtJa(isoCreatedAt: string): string {
  const date = new Date(isoCreatedAt)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}年${month}月${day}日 ${hour}:${minute} 作成`
}

/** e.g. `Created Oct 3, 2026, 11:00 PM` */
export function formatDuelMatchCreatedAtEn(isoCreatedAt: string): string {
  const parts = tokyoParts(isoCreatedAt)
  if (!parts) return ''
  return `Created ${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`
}
