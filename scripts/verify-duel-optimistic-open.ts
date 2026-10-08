/**
 * Step 4: optimistic DUEL OPEN — local prediction FX + parallel authoritative save.
 * Unlocks only when FX and server both complete; no double FX.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createOptimisticOpenGate,
  markOptimisticFailed,
  markOptimisticFxDone,
  markOptimisticServerDone,
  predictsClearsRound,
  sameLocalAndServerOpen,
} from '../src/duel/duelOptimisticOpen'
import type { DuelLocalOpenResult } from '../src/duel/duelOpponentPlacements'
import type { DuelOpenResult } from '../src/duel/duelPlayClient'
import { planCoinFx } from '../src/game/coinFx'

function local(
  outcome: DuelLocalOpenResult['outcome'],
  coinsFound: DuelLocalOpenResult['coinsFound'],
): DuelLocalOpenResult {
  return { outcome, coinsFound }
}

function server(
  outcome: DuelOpenResult['outcome'],
  coinsFound: DuelOpenResult['coinsFound'],
): DuelOpenResult {
  return {
    matchId: '11111111-1111-4111-8111-111111111111',
    roundNumber: 1,
    bagNumber: 1,
    openOrder: 1,
    outcome,
    coinsFound,
    provisionalCoins: outcome === 'coins' ? coinsFound : 0,
    roundEnded: outcome === 'bomb' || (outcome === 'coins' && coinsFound === 3),
    endReason: outcome === 'bomb' ? 'bombed' : outcome === 'coins' && coinsFound === 3 ? 'cleared' : null,
    capturedCoins: outcome === 'bomb' ? 0 : null,
    openedBagCount: 1,
    participantCompleted: false,
  }
}

// --- Gate: unlock only when both FX and server complete ---
{
  const gate = createOptimisticOpenGate()
  assert.equal(markOptimisticFxDone(gate), false, '7. FX alone must not unlock')
  assert.equal(gate.fxDone, true)
  assert.equal(markOptimisticServerDone(gate), true, '9. both done unlocks')
}

{
  const gate = createOptimisticOpenGate()
  assert.equal(markOptimisticServerDone(gate), false, '8. server alone must not unlock')
  assert.equal(markOptimisticFxDone(gate), true, '9. both done unlocks (server first)')
}

{
  const gate = createOptimisticOpenGate()
  markOptimisticFailed(gate)
  assert.equal(markOptimisticFxDone(gate), false, '18. failed gate never unlocks via FX')
  assert.equal(markOptimisticServerDone(gate), false, '18. failed gate never unlocks via server')
}

{
  const gate = createOptimisticOpenGate()
  assert.equal(markOptimisticFxDone(gate), false)
  markOptimisticFailed(gate)
  assert.equal(markOptimisticServerDone(gate), false, '18. failure after FX still blocks unlock')
}

// --- Local vs server match ---
assert.equal(sameLocalAndServerOpen(local('coins', 1), server('coins', 1)), true, '15')
assert.equal(sameLocalAndServerOpen(local('coins', 2), server('coins', 2)), true, '15')
assert.equal(sameLocalAndServerOpen(local('coins', 3), server('coins', 3)), true, '15')
assert.equal(sameLocalAndServerOpen(local('empty', 0), server('empty', 0)), true, '15')
assert.equal(sameLocalAndServerOpen(local('bomb', 0), server('bomb', 0)), true, '15')
assert.equal(sameLocalAndServerOpen(local('coins', 1), server('coins', 2)), false, '16')
assert.equal(sameLocalAndServerOpen(local('coins', 1), server('empty', 0)), false, '16')
assert.equal(sameLocalAndServerOpen(local('empty', 0), server('bomb', 0)), false, '16')
assert.equal(sameLocalAndServerOpen(local('bomb', 0), server('coins', 1)), false, '16')

assert.equal(predictsClearsRound(0, local('coins', 3)), true)
assert.equal(predictsClearsRound(2, local('coins', 1)), true)
assert.equal(predictsClearsRound(1, local('coins', 1)), false)
assert.equal(predictsClearsRound(0, local('empty', 0)), false)
assert.equal(predictsClearsRound(0, local('bomb', 0)), false)

// --- COIN 140ms timing preserved ---
for (const count of [1, 2, 3] as const) {
  assert.equal(planCoinFx('bag-1', count).bagHideMs, 140, `14. COIN×${count} bagHideMs`)
}

// --- Screen source: optimistic timeline + no double FX ---
const screen = await readFile(
  new URL('../src/components/DuelPlayScreen.tsx', import.meta.url),
  'utf8',
)
const helper = await readFile(
  new URL('../src/duel/duelOptimisticOpen.ts', import.meta.url),
  'utf8',
)
const coordinator = await readFile(
  new URL('../src/duel/duelPlayCoordinator.ts', import.meta.url),
  'utf8',
)

assert.match(screen, /getLocalOpenResult/, '1. local judge on tap')
assert.match(screen, /startPredictedOpenFx/, '2-5. predicted OPEN SE/FX')
assert.match(screen, /startOpenPresentation/, '2. OPEN SE via presentation start')
assert.match(screen, /kind: 'coins'/, '3/11-13. COIN FX')
assert.match(screen, /kind: 'bomb'/, '5. BOMB FX')
assert.match(screen, /kind: 'empty'/, '4. EMPTY FX')
assert.match(screen, /createOptimisticOpenGate/, '7-9. dual gate')
assert.match(screen, /markOptimisticFxDone/, '7. FX gate')
assert.match(screen, /markOptimisticServerDone/, '8. server gate')
assert.match(screen, /sameLocalAndServerOpen/, '15-16. local/server compare')
assert.match(screen, /markOptimisticFailed/, '16-18. mismatch/failure stop')
assert.match(screen, /openEpochRef/, '20-22. stale/unmount guard')
assert.match(screen, /epoch !== openEpochRef\.current/, '20-22. ignore stale')
assert.match(screen, /interactionLockedRef\.current = true/, '23. lock on tap')
assert.match(screen, /predictsClearsRound/, '11-13. coin clear prediction')

// Predicted FX starts before awaiting server OPEN (optimistic path).
const optimisticBlock = screen.match(
  /if \(local\) \{[\s\S]*?return\n    \}/,
)?.[0] ?? ''
assert.ok(optimisticBlock.length > 0, 'optimistic path block present')
assert.ok(
  optimisticBlock.indexOf('startPredictedOpenFx') < optimisticBlock.indexOf('await coordinator.open'),
  '2-5. FX/SE before server response wait',
)
assert.ok(
  optimisticBlock.includes('await coordinator.open'),
  '6. server OPEN started in parallel path',
)
assert.equal(
  (optimisticBlock.match(/setFx\(\{/g) ?? []).length,
  0,
  '10. optimistic path uses startPredictedOpenFx only (no inline setFx mount)',
)
assert.ok(
  optimisticBlock.indexOf('startPredictedOpenFx') < optimisticBlock.indexOf('await coordinator.open'),
  '10. no second SE after server in optimistic path',
)
assert.doesNotMatch(
  optimisticBlock,
  /await coordinator\.open[\s\S]*startPredictedOpenFx/,
  '10. no FX restart after server',
)
assert.doesNotMatch(
  optimisticBlock,
  /await coordinator\.open[\s\S]*startOpenPresentation/,
  '10. no SE restart after server',
)
assert.doesNotMatch(
  optimisticBlock,
  /await coordinator\.open[\s\S]*playBagOpen/,
  '10. no SE restart after server (legacy)',
)
assert.doesNotMatch(
  optimisticBlock,
  /await coordinator\.open[\s\S]*setFx\(\{/,
  '10. no FX remount after server',
)
assert.match(
  optimisticBlock,
  /sameLocalAndServerOpen\(local, result\)/,
  '15. compare before continuing',
)
assert.match(
  optimisticBlock,
  /!sameLocalAndServerOpen\(local, result\)[\s\S]*phase: 'error'/,
  '16. mismatch stops session',
)
assert.match(
  optimisticBlock,
  /!sameLocalAndServerOpen\(local, result\)[\s\S]*setFx\(null\)/,
  '17. mismatch clears FX without replaying',
)
assert.match(
  optimisticBlock,
  /catch \{[\s\S]*markOptimisticFailed\(gate\)[\s\S]*setRetryBag\(bagId\)/,
  '18. server failure does not treat prediction as final',
)
assert.match(
  optimisticBlock,
  /catch \{[\s\S]*if \(gate\.fxDone\) \{[\s\S]*finishOpenUnlock/,
  '18. unlock only after failed path settles (not mid-flight success)',
)

// Local unavailable → server-authoritative fallback (no guessed FX).
const fallbackBlock = screen.match(
  /let local: DuelLocalOpenResult \| null = null[\s\S]*?finally \{[\s\S]*?\n    \}/,
)?.[0] ?? ''
assert.ok(fallbackBlock.includes('local = null'), '19. local failure nulls prediction')
assert.ok(
  fallbackBlock.indexOf('await coordinator.open') <
      fallbackBlock.lastIndexOf('startOpenPresentation') ||
    /if \(local\) \{[\s\S]*startPredictedOpenFx[\s\S]*return\n    \}[\s\S]*await coordinator\.open[\s\S]*startOpenPresentation/.test(
      screen,
    ),
  '19. without local, FX waits for server',
)
assert.match(screen, /catch \{\s*local = null\s*\}/, '19. getLocalOpenResult failure → fallback')

// clearFx dual-gate: FX complete alone does not unlock while gate active.
assert.match(
  screen,
  /const clearFx = useCallback\(\(\) => \{[\s\S]*markOptimisticFxDone\(gate\)[\s\S]*finishOpenUnlock/,
  '7. clearFx goes through gate',
)
assert.match(
  screen,
  /if \(markOptimisticServerDone\(gate\)\) \{[\s\S]*finishOpenUnlock/,
  '8-9. server completion respects FX',
)

// Bomb/empty hide during predicted FX before authoritative openedBags update.
assert.match(
  screen,
  /fx\?\.kind === 'bomb' \|\| fx\?\.kind === 'empty'[\s\S]*next\.add\(fx\.bagId\)/,
  'bomb/empty hide without waiting for server opened set',
)

// Helpers stay pure / client-only.
assert.doesNotMatch(helper, /fetch\(|localStorage|sessionStorage|IndexedDB/)
assert.match(coordinator, /getLocalOpenResult/)
assert.match(coordinator, /async open\(/)

// Fallback still has exactly one setFx trio after server (no optimistic double).
const fallbackFx = screen.match(
  /\/\/ FALLBACK|local = null[\s\S]*const result = outcome\.result[\s\S]*if \(result\.roundEnded\) refreshSelfProgress/,
)?.[0]
void fallbackFx
const serverFirstFx = screen.match(
  /const result = outcome\.result\n      const nextRound = appendOpen\(round, result\)[\s\S]*if \(result\.roundEnded\) refreshSelfProgress\(\)/,
)?.[0] ?? ''
assert.ok(serverFirstFx.includes('setFx({'), 'fallback still mounts FX from server')
assert.equal((serverFirstFx.match(/setFx\(/g) ?? []).length, 3, 'fallback one FX per outcome')

console.log('DUEL optimistic OPEN verification passed.')
