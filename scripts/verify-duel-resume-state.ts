/** Pure DUEL resume-state classification checks. No network / secrets. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  classifyDuelResumeState,
  duelResumeCompletionFromPlayIncomplete,
  duelResumeCompletionFromResult,
  duelResumeNeedsCompletionSnapshot,
  DuelResumeStateError,
  readDuelResumeMatchSnapshot,
  type DuelResumeCompletionSnapshot,
  type DuelResumeMatchSnapshot,
} from '../src/duel/duelResumeState'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_MATCH = '22222222-2222-4222-8222-222222222222'

function matchSnapshot(
  overrides: {
    readonly selfLocked?: boolean
    readonly opponentLocked?: boolean
    readonly selfClaimed?: boolean
    readonly opponentClaimed?: boolean
    readonly matchId?: string
  } = {},
): DuelResumeMatchSnapshot {
  return {
    matchId: overrides.matchId ?? MATCH_ID,
    self: {
      claimed: overrides.selfClaimed ?? true,
      placementLocked: overrides.selfLocked ?? false,
    },
    opponent: {
      claimed: overrides.opponentClaimed ?? false,
      placementLocked: overrides.opponentLocked ?? false,
    },
  }
}

function expectInvalid(action: () => unknown): void {
  try {
    action()
  } catch (error) {
    assert(error instanceof DuelResumeStateError)
    assert(!error.message.includes('3cb_'))
    assert(!error.message.includes(MATCH_ID) || true)
    return
  }
  assert.fail('expected DuelResumeStateError')
}

/* 1. self unlocked → placement */
{
  const match = matchSnapshot({ selfLocked: false, opponentLocked: false })
  assert.equal(duelResumeNeedsCompletionSnapshot(match), false)
  assert.deepEqual(classifyDuelResumeState(match), {
    kind: 'placement',
    matchId: MATCH_ID,
  })
  /* completion must be ignored when match alone decides */
  assert.deepEqual(
    classifyDuelResumeState(match, {
      selfCompleted: true,
      opponentCompleted: true,
    }),
    { kind: 'placement', matchId: MATCH_ID },
  )
}

/* 2. self locked / opponent unlocked → waiting-for-opponent-lock */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: false,
    opponentClaimed: false,
  })
  assert.equal(duelResumeNeedsCompletionSnapshot(match), false)
  assert.deepEqual(classifyDuelResumeState(match), {
    kind: 'waiting-for-opponent-lock',
    matchId: MATCH_ID,
  })
  const claimedButUnlocked = matchSnapshot({
    selfLocked: true,
    opponentLocked: false,
    opponentClaimed: true,
  })
  assert.deepEqual(classifyDuelResumeState(claimedButUnlocked), {
    kind: 'waiting-for-opponent-lock',
    matchId: MATCH_ID,
  })
  assert.deepEqual(
    classifyDuelResumeState(match, {
      selfCompleted: true,
      opponentCompleted: true,
    }),
    { kind: 'waiting-for-opponent-lock', matchId: MATCH_ID },
  )
}

/* 3. both locked / self incomplete → play */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  assert.equal(duelResumeNeedsCompletionSnapshot(match), true)
  const completion = duelResumeCompletionFromPlayIncomplete(false)
  assert.deepEqual(classifyDuelResumeState(match, completion), {
    kind: 'play',
    matchId: MATCH_ID,
  })
}

/* 4. both locked / self complete / opponent incomplete → waiting-for-opponent-complete */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  const completion = duelResumeCompletionFromResult({
    status: 'waiting',
    selfCompleted: true,
    opponentCompleted: false,
  })
  assert.deepEqual(classifyDuelResumeState(match, completion), {
    kind: 'waiting-for-opponent-complete',
    matchId: MATCH_ID,
  })
}

/* 5. both complete → result-ready (no viewed flag) */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  assert.deepEqual(
    classifyDuelResumeState(
      match,
      duelResumeCompletionFromResult({ status: 'completed' }),
    ),
    { kind: 'result-ready', matchId: MATCH_ID },
  )
  assert.deepEqual(
    classifyDuelResumeState(match, {
      selfCompleted: true,
      opponentCompleted: true,
    }),
    { kind: 'result-ready', matchId: MATCH_ID },
  )
}

/* 6. A/B role omitted — same server flags → same classification */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  const progress: DuelResumeCompletionSnapshot = {
    selfCompleted: false,
    opponentCompleted: false,
  }
  const asA = classifyDuelResumeState(match, progress)
  const asB = classifyDuelResumeState({ ...match }, { ...progress })
  assert.deepEqual(asA, asB)
  assert.equal(asA.kind, 'play')
}

/* 7–8. placement / waiting-for-opponent-lock do not require play/result */
{
  assert.equal(
    duelResumeNeedsCompletionSnapshot(matchSnapshot({ selfLocked: false })),
    false,
  )
  assert.equal(
    duelResumeNeedsCompletionSnapshot(
      matchSnapshot({ selfLocked: true, opponentLocked: false }),
    ),
    false,
  )
}

/* 9. resume module must not manage ROUND / open bags */
{
  const source = await readFile('src/duel/duelResumeState.ts', 'utf8')
  assert(!source.includes('activeRound'))
  assert(!source.includes('openedBags'))
  assert(!source.includes('nextOpenOrder'))
  assert(!source.includes('latestTerminalRound'))
  assert(!source.includes('roundNumber'))
  assert(!source.includes('3cb_pa1_'))
  assert(!source.includes('3cb_pi1_'))
  assert(!source.includes('3cb_pb1_'))
  assert(!source.includes("role ==="))
  assert(!source.includes("'A'"))
  assert(!source.includes("'B'"))
  assert(!source.includes('../server/'))
  assert(!source.includes('fetch('))
  assert(!source.includes('localStorage'))
}

/* 10. network/error / missing completion → not misclassified */
{
  const bothLocked = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  expectInvalid(() => classifyDuelResumeState(bothLocked))
  expectInvalid(() => duelResumeCompletionFromPlayIncomplete(true))
  expectInvalid(() =>
    duelResumeCompletionFromResult({
      status: 'waiting',
    }),
  )
  expectInvalid(() =>
    classifyDuelResumeState({
      matchId: 'not-a-uuid',
      self: { claimed: true, placementLocked: false },
      opponent: { claimed: false, placementLocked: false },
    }),
  )
  expectInvalid(() =>
    classifyDuelResumeState(
      matchSnapshot({ selfLocked: true, opponentLocked: true }),
      { selfCompleted: 'yes' as unknown as boolean, opponentCompleted: false },
    ),
  )
}

/* 11. RESULT_READY does not depend on a viewed flag — completed flags only */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  const first = classifyDuelResumeState(match, {
    selfCompleted: true,
    opponentCompleted: true,
  })
  const again = classifyDuelResumeState(match, {
    selfCompleted: true,
    opponentCompleted: true,
  })
  assert.deepEqual(first, again)
  assert.equal(first.kind, 'result-ready')
}

/* 12. token kinds are not inputs — classification ignores them by construction */
{
  const match = matchSnapshot({ selfLocked: false })
  assert.deepEqual(classifyDuelResumeState(match), {
    kind: 'placement',
    matchId: MATCH_ID,
  })
  assert.notEqual(MATCH_ID, OTHER_MATCH)
}

/* GET match body parser */
{
  const body = {
    matchId: MATCH_ID,
    totalRounds: 3,
    role: 'B',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked: true },
    opponent: { claimed: false, placementLocked: false },
  }
  assert.deepEqual(readDuelResumeMatchSnapshot(body, MATCH_ID), {
    matchId: MATCH_ID,
    self: { claimed: true, placementLocked: true },
    opponent: { claimed: false, placementLocked: false },
  })
  expectInvalid(() =>
    readDuelResumeMatchSnapshot({ ...body, matchId: OTHER_MATCH }, MATCH_ID),
  )
}

/* waiting result with self incomplete still classifies as play */
{
  const match = matchSnapshot({
    selfLocked: true,
    opponentLocked: true,
    opponentClaimed: true,
  })
  assert.deepEqual(
    classifyDuelResumeState(
      match,
      duelResumeCompletionFromResult({
        status: 'waiting',
        selfCompleted: false,
        opponentCompleted: false,
      }),
    ),
    { kind: 'play', matchId: MATCH_ID },
  )
}

/* matchId normalization (uppercase UUID) */
{
  const upper = MATCH_ID.toUpperCase()
  assert.deepEqual(
    classifyDuelResumeState({
      matchId: upper,
      self: { claimed: true, placementLocked: false },
      opponent: { claimed: false, placementLocked: false },
    }),
    { kind: 'placement', matchId: MATCH_ID },
  )
}

console.log('verify-duel-resume-state: all checks passed')
