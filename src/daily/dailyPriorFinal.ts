/**
 * Pure helpers for yesterday's FINAL ranking gate (eng9F).
 * Eligibility uses local prior capability + server RESULT/RANKING — never nickname alone.
 */
import {
  previousUtcDailyChallengeDate,
  utcDailyChallengeDate,
  validateDailyChallengeDate,
  type DailyChallengeDate,
} from './dailyChallengeDate.js'
import { isDailyPriorFinalAcknowledged } from './dailyPriorFinalAckStorage.js'
import {
  readDailyParticipant,
  type DailyStorageAdapter,
  type JoinedDailyParticipantRecord,
} from './dailyParticipantStorage.js'
import type { DailyRankingView, DailySelfResultView } from './dailyRankingClient.js'

export type DailyPriorFinalGateDecision =
  | {
      readonly kind: 'skip'
      readonly reason:
        | 'no_storage'
        | 'no_prior_join'
        | 'already_acknowledged'
        | 'invalid_clock'
    }
  | {
      readonly kind: 'offer'
      readonly priorChallengeDate: DailyChallengeDate
      readonly entryChallengeDate: DailyChallengeDate
      readonly priorParticipant: JoinedDailyParticipantRecord
    }

/**
 * Sync local-only gate: offer prior FINAL when a joined prior capability exists
 * and has not been acknowledged. Does not hit the network (keeps TOP snappy).
 */
export function decideDailyPriorFinalGate(input: {
  readonly storage: DailyStorageAdapter | null | undefined
  readonly now?: Date
  readonly entryChallengeDate?: DailyChallengeDate
}): DailyPriorFinalGateDecision {
  let entryChallengeDate: DailyChallengeDate
  try {
    entryChallengeDate =
      input.entryChallengeDate !== undefined
        ? validateDailyChallengeDate(input.entryChallengeDate)
        : utcDailyChallengeDate(input.now ?? new Date())
  } catch {
    return { kind: 'skip', reason: 'invalid_clock' }
  }

  if (!input.storage) {
    return { kind: 'skip', reason: 'no_storage' }
  }

  const priorChallengeDate = previousUtcDailyChallengeDate(entryChallengeDate)

  if (isDailyPriorFinalAcknowledged(input.storage, priorChallengeDate)) {
    return { kind: 'skip', reason: 'already_acknowledged' }
  }

  let prior: ReturnType<typeof readDailyParticipant>
  try {
    prior = readDailyParticipant(input.storage, priorChallengeDate)
  } catch {
    // Unreadable prior participant → cannot prove completion locally; skip gate.
    return { kind: 'skip', reason: 'no_prior_join' }
  }
  if (!prior || prior.phase !== 'joined') {
    return { kind: 'skip', reason: 'no_prior_join' }
  }

  return {
    kind: 'offer',
    priorChallengeDate,
    entryChallengeDate,
    priorParticipant: prior,
  }
}

export type DailyPriorFinalFetchVerdict =
  | { readonly kind: 'show_final'; readonly self: DailySelfResultView; readonly ranking: DailyRankingView }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'retryable_error' }
  | { readonly kind: 'waiting_final' }

/**
 * Interprets RESULT + RANKING for a prior day already known to have a local join.
 * Only `show_final` may be acknowledged after explicit user CONTINUE.
 */
export function judgeDailyPriorFinalFetch(input: {
  readonly expectedPriorDate: DailyChallengeDate
  readonly expectedParticipantId: string
  readonly self:
    | { readonly kind: 'ok'; readonly value: DailySelfResultView }
    | { readonly kind: 'unauthorized' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'error' }
  readonly ranking:
    | { readonly kind: 'ok'; readonly value: DailyRankingView }
    | { readonly kind: 'unauthorized' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'error' }
    | { readonly kind: 'skipped' }
}): DailyPriorFinalFetchVerdict {
  if (input.self.kind === 'unauthorized') return { kind: 'unauthorized' }
  if (input.self.kind === 'unavailable') return { kind: 'not_eligible' }
  if (input.self.kind === 'error') return { kind: 'retryable_error' }

  const self = input.self.value
  if (self.challengeDate !== input.expectedPriorDate) return { kind: 'not_eligible' }
  if (self.participantId !== input.expectedParticipantId) {
    return { kind: 'not_eligible' }
  }
  if (!self.completedAt || self.rounds.length !== 20) {
    return { kind: 'not_eligible' }
  }

  if (input.ranking.kind === 'skipped') return { kind: 'retryable_error' }
  if (input.ranking.kind === 'unauthorized') return { kind: 'unauthorized' }
  if (input.ranking.kind === 'unavailable') return { kind: 'waiting_final' }
  if (input.ranking.kind === 'error') return { kind: 'retryable_error' }

  const ranking = input.ranking.value
  if (ranking.challengeDate !== input.expectedPriorDate) {
    return { kind: 'retryable_error' }
  }
  if (ranking.self.participantId !== input.expectedParticipantId) {
    return { kind: 'retryable_error' }
  }
  if (ranking.status !== 'final') {
    return { kind: 'waiting_final' }
  }

  return { kind: 'show_final', self, ranking }
}

/** True only when CONTINUE may persist ack and enter today's DAILY. */
export function canAcknowledgeDailyPriorFinal(
  verdict: DailyPriorFinalFetchVerdict,
): boolean {
  return verdict.kind === 'show_final'
}
