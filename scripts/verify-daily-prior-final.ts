/**
 * DAILY prior-day FINAL gate (eng9F) — pure gate/ack + source wiring (no real DB).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  previousUtcDailyChallengeDate,
  utcDailyChallengeDate,
} from '../src/daily/dailyChallengeDate.ts'
import {
  canAcknowledgeDailyPriorFinal,
  decideDailyPriorFinalGate,
  judgeDailyPriorFinalFetch,
} from '../src/daily/dailyPriorFinal.ts'
import {
  dailyPriorFinalAckStorageKey,
  isDailyPriorFinalAcknowledged,
  readDailyPriorFinalAck,
  saveDailyPriorFinalAck,
} from '../src/daily/dailyPriorFinalAckStorage.ts'
import {
  dailyParticipantStorageKey,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
} from '../src/daily/dailyParticipantStorage.ts'
import type {
  DailyRankingView,
  DailySelfResultView,
} from '../src/daily/dailyRankingClient.ts'
import { en } from '../src/i18n/en.ts'
import { ja } from '../src/i18n/ja.ts'

const root = resolve(import.meta.dirname, '..')

function memoryStorage(seed: Record<string, string> = {}): DailyStorageAdapter & {
  readonly data: Record<string, string>
} {
  const data = { ...seed }
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
  }
}

function joined(prior: string): JoinedDailyParticipantRecord {
  return {
    version: 1,
    phase: 'joined',
    challengeDate: prior,
    joinRequestId: '11111111-1111-4111-8111-111111111111',
    participantId: '22222222-2222-4222-8222-222222222222',
    nickname: 'PriorPlayer',
    token: `3cb_dp1_${'A'.repeat(43)}`,
    acceptedAt: `${prior}T00:05:00.000Z`,
  }
}

function boardRound(roundNumber: number) {
  return {
    roundNumber,
    endReason: 'timed_out' as const,
    capturedCoins: 0 as const,
    openedBagCount: 0,
    coinBagHits: 0,
    elapsedSeconds: 60,
    bagCount: 8,
    bombBagNumber: 8,
    coinBagNumbers: [1, 2, 3] as [number, number, number],
    opens: [] as const,
  }
}

function selfView(prior: string, participantId: string): DailySelfResultView {
  return {
    challengeDate: prior,
    participantId,
    nickname: 'PriorPlayer',
    acceptedAt: `${prior}T00:05:00.000Z`,
    completedAt: `${prior}T12:00:00.000Z`,
    totalCoins: 12,
    threeCoinsComplete: 3,
    coinBagHits: 5,
    totalOpens: 10,
    coinBagHitRate: { numerator: 5, denominator: 10 },
    rounds: Array.from({ length: 20 }, (_, i) => boardRound(i + 1)),
  }
}

function rankingView(
  prior: string,
  participantId: string,
  status: 'provisional' | 'final',
): DailyRankingView {
  const entry = {
    participantId,
    rank: 2,
    nickname: 'PriorPlayer',
    totalCoins: 12,
    threeCoinsComplete: 3,
    coinBagHits: 5,
    totalOpens: 10,
    coinBagHitRate: { numerator: 5, denominator: 10 },
    isSelf: true,
  }
  const close = new Date(`${prior}T00:00:00.000Z`)
  close.setUTCDate(close.getUTCDate() + 1)
  return {
    challengeDate: prior,
    status,
    rankingAsOf:
      status === 'final' ? close.toISOString() : `${prior}T23:50:00.000Z`,
    topEntries: [entry],
    self: entry,
    selfInTop: true,
    totalRankedParticipants: 1,
  }
}

// --- UTC previous day (23–26): not JST midnight ---
assert.equal(previousUtcDailyChallengeDate('2026-10-15'), '2026-10-14')
assert.equal(previousUtcDailyChallengeDate('2026-11-01'), '2026-10-31')
assert.equal(previousUtcDailyChallengeDate('2027-01-01'), '2026-12-31')
assert.equal(
  previousUtcDailyChallengeDate(utcDailyChallengeDate(new Date('2026-10-15T00:00:00.000Z'))),
  '2026-10-14',
)
// JST midnight 2026-10-15 00:00+09 = 2026-10-14T15:00Z → still UTC 10-14
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-14T15:00:00.000Z')),
  '2026-10-14',
)
assert.equal(previousUtcDailyChallengeDate('2026-10-14'), '2026-10-13')
// JST 09:00 = UTC 00:00 → date flips at UTC midnight (= JST 09:00)
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-14T23:59:59.999Z')),
  '2026-10-14',
)
assert.equal(
  utcDailyChallengeDate(new Date('2026-10-15T00:00:00.000Z')),
  '2026-10-15',
)

const prior = '2026-10-14'
const today = '2026-10-15'
const participant = joined(prior)
const storage = memoryStorage({
  [dailyParticipantStorageKey(prior)]: JSON.stringify(participant),
})

// 1: prior complete candidate → offer
assert.deepEqual(
  decideDailyPriorFinalGate({
    storage,
    entryChallengeDate: today,
  }).kind,
  'offer',
)
const offer = decideDailyPriorFinalGate({
  storage,
  entryChallengeDate: today,
})
assert.equal(offer.kind, 'offer')
if (offer.kind === 'offer') {
  assert.equal(offer.priorChallengeDate, prior)
  assert.equal(offer.entryChallengeDate, today)
  assert.equal(offer.priorParticipant.participantId, participant.participantId)
}

// 2: no prior join → skip
assert.equal(
  decideDailyPriorFinalGate({
    storage: memoryStorage(),
    entryChallengeDate: today,
  }).kind,
  'skip',
)

// 4 / 18: ack after confirm → skip
saveDailyPriorFinalAck(storage, {
  priorChallengeDate: prior,
  entryChallengeDate: today,
  acknowledgedAt: '2026-10-15T00:10:00.000Z',
})
assert.equal(isDailyPriorFinalAcknowledged(storage, prior), true)
assert.equal(
  decideDailyPriorFinalGate({ storage, entryChallengeDate: today }).kind,
  'skip',
)
assert.equal(
  readDailyPriorFinalAck(storage, prior)?.priorChallengeDate,
  prior,
)
assert.match(dailyPriorFinalAckStorageKey(prior), /prior-final-ack:2026-10-14/)

// 16–17: opening offer path must not invent ack
const storage2 = memoryStorage({
  [dailyParticipantStorageKey(prior)]: JSON.stringify(participant),
})
assert.equal(isDailyPriorFinalAcknowledged(storage2, prior), false)
decideDailyPriorFinalGate({ storage: storage2, entryChallengeDate: today })
assert.equal(isDailyPriorFinalAcknowledged(storage2, prior), false)

// 19: write failure → not acknowledged
const failWrite: DailyStorageAdapter = {
  getItem: () => null,
  setItem: () => {
    throw new Error('quota')
  },
}
assert.throws(() =>
  saveDailyPriorFinalAck(failWrite, {
    priorChallengeDate: prior,
    entryChallengeDate: today,
  }),
)

// Fetch verdicts 3,5–10,14
const selfOk = selfView(prior, participant.participantId)
const rankingFinal = rankingView(prior, participant.participantId, 'final')
const rankingProv = rankingView(prior, participant.participantId, 'provisional')

assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'unavailable' },
    ranking: { kind: 'skipped' },
  }).kind,
  'not_eligible',
)
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'unauthorized' },
    ranking: { kind: 'skipped' },
  }).kind,
  'unauthorized',
)
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'error' },
    ranking: { kind: 'skipped' },
  }).kind,
  'retryable_error',
)
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'ok', value: selfOk },
    ranking: { kind: 'error' },
  }).kind,
  'retryable_error',
)
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'ok', value: selfOk },
    ranking: { kind: 'unavailable' },
  }).kind,
  'waiting_final',
)
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'ok', value: selfOk },
    ranking: { kind: 'ok', value: rankingProv },
  }).kind,
  'waiting_final',
)
const show = judgeDailyPriorFinalFetch({
  expectedPriorDate: prior,
  expectedParticipantId: participant.participantId,
  self: { kind: 'ok', value: selfOk },
  ranking: { kind: 'ok', value: rankingFinal },
})
assert.equal(show.kind, 'show_final')
assert.equal(canAcknowledgeDailyPriorFinal(show), true)
assert.equal(
  canAcknowledgeDailyPriorFinal({ kind: 'waiting_final' }),
  false,
)

// participant mismatch
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: {
      kind: 'ok',
      value: selfView(prior, '33333333-3333-4333-8333-333333333333'),
    },
    ranking: { kind: 'ok', value: rankingFinal },
  }).kind,
  'not_eligible',
)

// 11: prior vs today storage keys differ
assert.notEqual(
  dailyParticipantStorageKey(prior),
  dailyParticipantStorageKey(today),
)
assert.notEqual(
  dailyPriorFinalAckStorageKey(prior),
  dailyParticipantStorageKey(prior),
)

// The successful ack action is explicit; bypass/error CONTINUE copy stays shared.
assert.equal(ja.dailyPriorFinalContinue, '今日のDAILYへ')
assert.equal(en.dailyPriorFinalContinue, "TODAY'S DAILY")
assert.equal(en.groupContinue, 'CONTINUE')
assert.equal(en.duelReturnToTop, 'BACK TO TOP')
assert.equal(en.groupResultRetry, 'TRY AGAIN')

// --- Source wiring ---
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
assert.match(app, /decideDailyPriorFinalGate/)
assert.match(app, /DailyPriorFinalScreen/)
assert.match(app, /prior_final/)
assert.match(app, /onAcknowledgedContinue/)
assert.doesNotMatch(app, /mode === 'solo'[\s\S]{0,80}decideDailyPriorFinalGate/)

const priorUi = readFileSync(
  resolve(root, 'src/components/DailyPriorFinalScreen.tsx'),
  'utf8',
)
assert.match(priorUi, /DailyResultDetailScreen/)
assert.match(priorUi, /DailyResultRankingTable/)
assert.match(priorUi, /saveDailyPriorFinalAck/)
assert.match(priorUi, /groupContinue/)
assert.match(priorUi, /dailyPriorFinalContinue/)
assert.match(priorUi, /daily-prior-final__continue/)
assert.match(priorUi, /data-daily-prior-final-continue/)
assert.match(priorUi, /data-daily-prior-final-bypass/)
assert.match(priorUi, /fetchGenerationRef/)
assert.match(priorUi, /Ack path only/)
// Bypass CONTINUE must not call saveDailyPriorFinalAck (ack only in confirmContinue).
assert.equal((priorUi.match(/saveDailyPriorFinalAck/g) ?? []).length, 2) // import + call
assert.match(
  priorUi,
  /confirmContinue[\s\S]*saveDailyPriorFinalAck[\s\S]*onAcknowledgedContinue/,
)
assert.doesNotMatch(
  priorUi,
  /data-daily-prior-final-bypass=""[\s\S]{0,120}saveDailyPriorFinalAck/,
)
assert.doesNotMatch(priorUi, /msUntilNextDailyRankingRefresh|setInterval/)
assert.doesNotMatch(priorUi, /totalTimeSeconds/)
assert.match(priorUi, /fetchDailySelfResult/)
assert.match(priorUi, /fetchDailyRanking/)

// Ranking date mismatch → not show_final
assert.equal(
  judgeDailyPriorFinalFetch({
    expectedPriorDate: prior,
    expectedParticipantId: participant.participantId,
    self: { kind: 'ok', value: selfOk },
    ranking: {
      kind: 'ok',
      value: { ...rankingFinal, challengeDate: today },
    },
  }).kind,
  'retryable_error',
)

const ack = readFileSync(
  resolve(root, 'src/daily/dailyPriorFinalAckStorage.ts'),
  'utf8',
)
assert.match(ack, /3cb:daily:v1:prior-final-ack:/)
assert.doesNotMatch(ack, /\b(?:DELETE|TRUNCATE|DROP)\b/i)

const gate = readFileSync(resolve(root, 'src/daily/dailyPriorFinal.ts'), 'utf8')
assert.match(gate, /previousUtcDailyChallengeDate/)
assert.match(gate, /judgeDailyPriorFinalFetch/)

// Non-regression: OPEN / 9E refresh modules untouched by this feature's imports
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/daily/dailyLocalOpen.ts'), 'utf8'),
  /priorFinal|PriorFinal/,
)
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/daily/dailyRankingRefresh.ts'), 'utf8'),
  /priorFinal|PriorFinal/,
)
assert.doesNotMatch(
  readFileSync(resolve(root, 'src/components/GroupResultScreen.tsx'), 'utf8'),
  /PriorFinal/,
)

assert.match(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
  /verify:daily-prior-final/,
)

console.log('verify:daily-prior-final OK')
