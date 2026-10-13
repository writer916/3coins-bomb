import {
  drawQuestion,
  questionPlacementKey,
  recentSoloQuestionKeys,
  type QuestionPlacement,
} from './questionGeneration'
import { defaultRandom, type RandomSource } from './random'

export const SOLO_QUESTION_HISTORY_KEY = '3cb.soloQuestionHistory'
export const SOLO_QUESTION_HISTORY_VERSION = 1 as const

export type SoloQuestionHistoryRecord = {
  readonly version: typeof SOLO_QUESTION_HISTORY_VERSION
  readonly keys: readonly string[]
}

export interface SoloQuestionHistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): SoloQuestionHistoryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readSoloQuestionHistory(
  storage: SoloQuestionHistoryStorage | null = defaultStorage(),
): readonly string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(SOLO_QUESTION_HISTORY_KEY)
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== SOLO_QUESTION_HISTORY_VERSION ||
      !Array.isArray((value as Record<string, unknown>).keys)
    ) {
      return []
    }
    return recentSoloQuestionKeys((value as Record<string, unknown>).keys as unknown[])
  } catch {
    return []
  }
}

export function writeSoloQuestionHistory(
  keys: Iterable<unknown>,
  storage: SoloQuestionHistoryStorage | null = defaultStorage(),
): readonly string[] {
  const recent = recentSoloQuestionKeys(keys)
  if (!storage) return recent
  const record: SoloQuestionHistoryRecord = {
    version: SOLO_QUESTION_HISTORY_VERSION,
    keys: recent,
  }
  try {
    storage.setItem(SOLO_QUESTION_HISTORY_KEY, JSON.stringify(record))
  } catch {
    // History persistence is best effort and must never block SOLO play.
  }
  return recent
}

export function createSoloQuestionSession(
  storage: SoloQuestionHistoryStorage | null = defaultStorage(),
  random: RandomSource = defaultRandom,
): {
  readonly getInitialQuestion: () => QuestionPlacement
  readonly nextQuestion: () => QuestionPlacement
  readonly getHistory: () => readonly string[]
} {
  let history = readSoloQuestionHistory(storage)
  let initialQuestion: QuestionPlacement | null = null

  const nextQuestion = (): QuestionPlacement => {
    const question = drawQuestion(random, history)
    history = writeSoloQuestionHistory(
      [...history, questionPlacementKey(question)],
      storage,
    )
    return question
  }

  return {
    getInitialQuestion() {
      initialQuestion ??= nextQuestion()
      return initialQuestion
    },
    nextQuestion,
    getHistory() {
      return history
    },
  }
}
