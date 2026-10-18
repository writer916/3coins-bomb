import assert from 'node:assert/strict'
import { formatDailyRankingFinalTime } from '../src/daily/dailyRankingFinalTime.ts'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const format = (
  challengeDate: string,
  locale: 'ja' | 'en',
  timeZone: string | null,
  fallbackOffsetMinutes?: number,
) =>
  formatDailyRankingFinalTime(challengeDate, locale, {
    timeZone,
    fallbackOffsetMinutes,
  })

assert.equal(format('2026-07-14', 'ja', 'Asia/Tokyo'), '日本時間9:00')
assert.equal(format('2026-07-14', 'en', 'Asia/Tokyo'), '9:00 JST')
assert.equal(format('2026-07-14', 'ja', 'Asia/Shanghai'), '中国標準時8:00')
assert.equal(format('2026-07-14', 'ja', 'Asia/Seoul'), '韓国標準時9:00')
assert.equal(format('2026-07-14', 'ja', 'Asia/Kolkata'), 'インド標準時5:30')

assert.equal(format('2026-01-14', 'en', 'Europe/London'), '0:00 Greenwich Mean Time')
assert.equal(format('2026-07-14', 'en', 'Europe/London'), '1:00 British Summer Time')
assert.equal(format('2026-01-14', 'en', 'America/New_York'), '19:00 EST')
assert.equal(format('2026-07-14', 'en', 'America/New_York'), '20:00 EDT')
assert.equal(format('2026-01-14', 'en', 'America/Los_Angeles'), '16:00 PST')
assert.equal(format('2026-07-14', 'en', 'America/Los_Angeles'), '17:00 PDT')
assert.equal(format('2026-01-14', 'ja', 'Australia/Sydney'), 'オーストラリア東部夏時間11:00')
assert.equal(format('2026-07-14', 'ja', 'Australia/Sydney'), 'オーストラリア東部標準時10:00')

assert.equal(format('2026-07-14', 'ja', null, 330), 'UTC+05:30 5:30')
assert.equal(format('2026-07-14', 'en', null, -240), '20:00 UTC-04:00')
assert.equal(format('2026-07-14', 'ja', 'Invalid/Zone', 330), 'UTC+05:30 5:30')

assert.equal(
  ja.dailyProvisionalResultDescription(format('2026-07-14', 'ja', 'Asia/Tokyo')),
  '順位は10分ごとに更新され、日本時間9:00（UTC 0:00）に確定します。',
)
assert.equal(
  en.dailyProvisionalResultDescription(format('2026-07-14', 'en', 'Asia/Tokyo')),
  'Rankings update every 10 minutes and become final at 9:00 JST (00:00 UTC).',
)

console.log('verify:daily-ranking-final-time OK')
