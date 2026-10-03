/**
 * Post-auth resume routing for placement-locked participants only.
 * Unlocked placement resume is intentionally out of scope.
 */
import type { DuelFinalResult } from './duelPlayClient'
import {
  classifyDuelResumeState,
  duelResumeCompletionFromResult,
  duelResumeNeedsCompletionSnapshot,
  DuelResumeStateError,
  type DuelResumeMatchSnapshot,
} from './duelResumeState'

export class DuelLockedResumeError extends Error {
  constructor() {
    super('The DUEL locked resume route could not be determined.')
    this.name = 'DuelLockedResumeError'
  }
}

export type DuelLockedResumeRoute =
  | { readonly kind: 'waiting-for-opponent-lock'; readonly matchId: string }
  | { readonly kind: 'play'; readonly matchId: string }
  | {
      readonly kind: 'waiting-for-opponent-complete'
      readonly matchId: string
      readonly initialResult: Extract<DuelFinalResult, { status: 'waiting' }>
    }
  | {
      readonly kind: 'result-ready'
      readonly matchId: string
      readonly initialResult: Extract<DuelFinalResult, { status: 'completed' }>
    }

function fail(): never {
  throw new DuelLockedResumeError()
}

/**
 * Classify a locked participant into a post-LOCK resume route.
 * Fetches GET /result only when both participants are placement-locked.
 */
export async function resolveDuelLockedResume(input: {
  readonly match: DuelResumeMatchSnapshot
  readonly fetchResult: () => Promise<DuelFinalResult>
}): Promise<DuelLockedResumeRoute> {
  if (!input.match.self.placementLocked) return fail()

  if (!duelResumeNeedsCompletionSnapshot(input.match)) {
    try {
      const resume = classifyDuelResumeState(input.match)
      if (resume.kind !== 'waiting-for-opponent-lock') return fail()
      return {
        kind: 'waiting-for-opponent-lock',
        matchId: resume.matchId,
      }
    } catch (error: unknown) {
      if (error instanceof DuelResumeStateError) return fail()
      throw error
    }
  }

  let result: DuelFinalResult
  try {
    result = await input.fetchResult()
  } catch {
    return fail()
  }

  let completion
  try {
    completion = duelResumeCompletionFromResult(
      result.status === 'completed'
        ? { status: 'completed' }
        : {
            status: 'waiting',
            selfCompleted: result.selfCompleted,
            opponentCompleted: result.opponentCompleted,
          },
    )
  } catch (error: unknown) {
    if (error instanceof DuelResumeStateError) return fail()
    throw error
  }

  let resume
  try {
    resume = classifyDuelResumeState(input.match, completion)
  } catch (error: unknown) {
    if (error instanceof DuelResumeStateError) return fail()
    throw error
  }

  if (resume.kind === 'play') {
    return { kind: 'play', matchId: resume.matchId }
  }
  if (resume.kind === 'waiting-for-opponent-complete') {
    if (result.status !== 'waiting') return fail()
    return {
      kind: 'waiting-for-opponent-complete',
      matchId: resume.matchId,
      initialResult: result,
    }
  }
  if (resume.kind === 'result-ready') {
    if (result.status !== 'completed') return fail()
    return {
      kind: 'result-ready',
      matchId: resume.matchId,
      initialResult: result,
    }
  }
  return fail()
}
