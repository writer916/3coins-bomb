import assert from 'node:assert/strict'
import {
  formatDailyChallengePeriodDisplay,
  formatDailyRankingFinalTime,
} from '../src/daily/dailyRankingFinalTime.ts'
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

const period = (
  challengeDate: string,
  locale: 'ja' | 'en',
  timeZone: string | null,
  fallbackOffsetMinutes?: number,
) =>
  formatDailyChallengePeriodDisplay(challengeDate, locale, {
    timeZone,
    fallbackOffsetMinutes,
  })

assert.deepEqual(period('2026-10-18', 'ja', 'Asia/Tokyo'), {
  timeZoneName: '日本時間',
  startsAt: '10月18日 9:00',
  endsAt: '10月19日 9:00',
})
assert.deepEqual(period('2026-10-18', 'en', 'Asia/Tokyo'), {
  timeZoneName: 'JST',
  startsAt: 'Oct 18 9:00',
  endsAt: 'Oct 19 9:00',
})
assert.equal(period('2026-10-18', 'ja', 'Asia/Shanghai').startsAt, '10月18日 8:00')
assert.equal(period('2026-10-18', 'ja', 'Asia/Seoul').startsAt, '10月18日 9:00')
assert.equal(period('2026-10-18', 'en', 'Europe/London').startsAt, 'Oct 18 1:00')
assert.equal(period('2026-01-18', 'en', 'Europe/London').startsAt, 'Jan 18 0:00')
assert.deepEqual(period('2026-10-18', 'en', 'America/New_York'), {
  timeZoneName: 'EDT',
  startsAt: 'Oct 17 20:00',
  endsAt: 'Oct 18 20:00',
})
assert.equal(period('2026-01-18', 'en', 'America/New_York').startsAt, 'Jan 17 19:00')
assert.equal(period('2026-10-18', 'en', 'America/Los_Angeles').startsAt, 'Oct 17 17:00')
assert.equal(period('2026-01-18', 'en', 'America/Los_Angeles').startsAt, 'Jan 17 16:00')
assert.deepEqual(period('2026-10-18', 'en', 'Asia/Kolkata'), {
  timeZoneName: 'India Standard Time',
  startsAt: 'Oct 18 5:30',
  endsAt: 'Oct 19 5:30',
})
assert.equal(period('2026-01-18', 'en', 'Australia/Sydney').startsAt, 'Jan 18 11:00')
assert.equal(period('2026-07-18', 'en', 'Australia/Sydney').startsAt, 'Jul 18 10:00')
assert.deepEqual(period('2026-03-08', 'en', 'America/New_York'), {
  timeZoneName: 'EST/EDT',
  startsAt: 'Mar 7 19:00',
  endsAt: 'Mar 8 20:00',
})
assert.deepEqual(period('2026-12-31', 'ja', 'Asia/Tokyo'), {
  timeZoneName: '日本時間',
  startsAt: '2026年12月31日 9:00',
  endsAt: '2027年1月1日 9:00',
})
assert.deepEqual(period('2026-10-18', 'en', null, 330), {
  timeZoneName: 'UTC+05:30',
  startsAt: 'Oct 18 5:30',
  endsAt: 'Oct 19 5:30',
})
assert.deepEqual(period('2026-10-18', 'ja', 'Invalid/Zone', -240), {
  timeZoneName: 'UTC-04:00',
  startsAt: '10月17日 20:00',
  endsAt: '10月18日 20:00',
})

assert.equal(
  ja.dailyProvisionalResultDescription(format('2026-07-14', 'ja', 'Asia/Tokyo')),
  '順位は10分ごとに更新され、日本時間9:00（UTC 0:00）に確定します。',
)
assert.equal(
  en.dailyProvisionalResultDescription(format('2026-07-14', 'en', 'Asia/Tokyo')),
  'Rankings update every 10 minutes and become final at 9:00 JST (00:00 UTC).',
)

console.log('verify:daily-ranking-final-time OK')
