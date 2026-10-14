/**
 * Pure builders for DAILY personal RESULT detail boards (play-order ROUNDs).
 * Uses persisted placements + OPEN rows — never invents bag outcomes.
 */
import {
  judgeDailyBag,
  validateDailyPlayPlacement,
  type DailyPlayPlacement,
} from './dailyLocalOpen.js'
import { DAILY_CHALLENGE_ROUNDS } from './dailyQuestionSet.js'
import type { DailyTerminalEndReason } from './dailyResult.js'
import type { AppStrings } from '../i18n/types.js'

export interface DailyResultOpenRecord {
  readonly roundNumber: number
  readonly openOrder: number
  readonly bagNumber: number
}

export interface DailyResultDetailOpen {
  readonly order: number
  readonly bagNumber: number
  readonly kind: 'empty' | 'coins' | 'bomb'
  readonly coinCount: 0 | 1 | 2 | 3
}

export interface DailyResultDetailRoundView {
  readonly roundNumber: number
  readonly endReason: DailyTerminalEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly elapsedSeconds: number
  readonly bagCount: number
  readonly bombBagNumber: number
  readonly coinBagNumbers: readonly [number, number, number]
  readonly opens: readonly DailyResultDetailOpen[]
}

export interface DailyResultRoundScoreView {
  readonly roundNumber: number
  readonly endReason: DailyTerminalEndReason
  readonly capturedCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly coinBagHits: number
  readonly elapsedSeconds: number
}

export interface DailyAttemptOrderCheck {
  readonly roundNumber: number
  readonly challengeRoundNumber: number
  readonly openedBagCount: number
}

/**
 * Reveals OPEN outcomes from the play-order placement (same rules as PLAY FX).
 */
export function revealDailyRoundOpens(
  placement: DailyPlayPlacement,
  opens: readonly DailyResultOpenRecord[],
): readonly DailyResultDetailOpen[] {
  return opens.map((opened) => {
    const judged = judgeDailyBag(placement, opened.bagNumber)
    return {
      order: opened.openOrder,
      bagNumber: opened.bagNumber,
      kind: judged.outcome,
      coinCount: judged.coinsFound,
    }
  })
}

/**
 * Joins summary ROUNDs + play-order placements + OPEN history.
 * Returns null on any inconsistency (caller maps to UNAVAILABLE).
 */
export function tryBuildDailyResultDetailRounds(input: {
  readonly rounds: readonly DailyResultRoundScoreView[]
  readonly placements: readonly DailyPlayPlacement[]
  readonly opens: readonly DailyResultOpenRecord[]
  readonly attempts: readonly DailyAttemptOrderCheck[]
  readonly questionOrder: readonly number[]
}): readonly DailyResultDetailRoundView[] | null {
  const { rounds, placements, opens, attempts, questionOrder } = input
  if (
    rounds.length !== DAILY_CHALLENGE_ROUNDS ||
    placements.length !== DAILY_CHALLENGE_ROUNDS ||
    attempts.length !== DAILY_CHALLENGE_ROUNDS ||
    questionOrder.length !== DAILY_CHALLENGE_ROUNDS
  ) {
    return null
  }

  const opensByRound = new Map<number, DailyResultOpenRecord[]>()
  for (const opened of opens) {
    if (
      !Number.isInteger(opened.roundNumber) ||
      opened.roundNumber < 1 ||
      opened.roundNumber > DAILY_CHALLENGE_ROUNDS ||
      !Number.isInteger(opened.openOrder) ||
      opened.openOrder < 1 ||
      opened.openOrder > 8 ||
      !Number.isInteger(opened.bagNumber) ||
      opened.bagNumber < 1 ||
      opened.bagNumber > 8
    ) {
      return null
    }
    const list = opensByRound.get(opened.roundNumber)
    if (list) list.push(opened)
    else opensByRound.set(opened.roundNumber, [opened])
  }

  const attemptByRound = new Map(
    attempts.map((attempt) => [attempt.roundNumber, attempt]),
  )
  const detail: DailyResultDetailRoundView[] = []

  for (let index = 0; index < DAILY_CHALLENGE_ROUNDS; index += 1) {
    const roundNumber = index + 1
    const score = rounds[index]
    const placementRaw = placements[index]
    const attempt = attemptByRound.get(roundNumber)
    if (!score || !placementRaw || !attempt) return null
    if (score.roundNumber !== roundNumber || attempt.roundNumber !== roundNumber) {
      return null
    }
    if (attempt.challengeRoundNumber !== questionOrder[index]) return null
    if (attempt.openedBagCount !== score.openedBagCount) return null

    let placement: DailyPlayPlacement
    try {
      placement = validateDailyPlayPlacement(placementRaw, roundNumber)
    } catch {
      return null
    }

    const roundOpens = [...(opensByRound.get(roundNumber) ?? [])].sort(
      (a, b) => a.openOrder - b.openOrder,
    )
    if (roundOpens.length !== score.openedBagCount) return null
    const seenBags = new Set<number>()
    for (let openIndex = 0; openIndex < roundOpens.length; openIndex += 1) {
      const opened = roundOpens[openIndex]!
      if (opened.openOrder !== openIndex + 1) return null
      if (opened.bagNumber > placement.bagCount) return null
      if (seenBags.has(opened.bagNumber)) return null
      seenBags.add(opened.bagNumber)
    }

    let revealed: readonly DailyResultDetailOpen[]
    try {
      revealed = revealDailyRoundOpens(placement, roundOpens)
    } catch {
      return null
    }
    if (revealed.length !== score.openedBagCount) return null

    // Captured coins from opens must not contradict BOMB / cleared semantics.
    if (score.endReason === 'bombed') {
      const hitBomb = revealed.some((opened) => opened.kind === 'bomb')
      if (!hitBomb || score.capturedCoins !== 0) return null
    }
    if (score.endReason === 'cleared' && score.capturedCoins !== 3) return null
    if (
      score.endReason === 'cashed_out' &&
      score.capturedCoins !== 1 &&
      score.capturedCoins !== 2
    ) {
      return null
    }
    if (score.endReason === 'timed_out' && score.capturedCoins !== 0) return null

    detail.push({
      roundNumber,
      endReason: score.endReason,
      capturedCoins: score.capturedCoins,
      openedBagCount: score.openedBagCount,
      coinBagHits: score.coinBagHits,
      elapsedSeconds: score.elapsedSeconds,
      bagCount: placement.bagCount,
      bombBagNumber: placement.bombBagNumber,
      coinBagNumbers: placement.coinBagNumbers,
      opens: revealed,
    })
  }

  return detail
}

export function formatDailyRoundEndReason(
  endReason: DailyTerminalEndReason,
  t: AppStrings,
): string {
  if (endReason === 'cleared') return t.groupThreeCoinsComplete
  if (endReason === 'cashed_out') return t.groupRoundCashedOut
  if (endReason === 'bombed') return t.groupRoundBombed
  return t.dailyTimeoutLabel
}
