/**
 * Source / bootstrap wiring for A unlocked #p → existing-match placement.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createDuelClaimBootstrapCoordinator } from '../src/duel/duelClaim'
import { createDuelALockCoordinator } from '../src/duel/duelCreateLock'
import { createDuelParticipantLockCoordinator } from '../src/duel/duelParticipantLock'
import {
  readParticipant,
  type StorageAdapter,
} from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const PA1 = `3cb_pa1_${'a'.repeat(42)}A`
const P_URL = `https://example.test/duel/${MATCH_ID}#p=${PA1}`
const CREATED_AT = '2026-01-01T00:00:00.000Z'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/* Bootstrap: unlocked A #p imports pa1 + totalRounds; single GET match */
{
  const storage = new MemoryStorage()
  const urls: string[] = []
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: { getRandomValues: (arr) => arr },
    fetch: async (input) => {
      urls.push(String(input))
      if (String(input) === '/api/duel/matches') {
        assert.fail('unlocked A #p must not create a match')
      }
      return json({
        matchId: MATCH_ID,
        totalRounds: 3,
        role: 'A',
        createdAt: CREATED_AT,
        expiresAt: null,
        formationVersion: 1,
        ruleVersion: 1,
        self: { claimed: true, placementLocked: false },
        opponent: { claimed: false, placementLocked: false },
      })
    },
  }).run(P_URL)
  assert.equal(result.kind, 'participant-a')
  assert.equal(result.state.self.placementLocked, false)
  assert.equal(result.state.totalRounds, 3)
  assert.equal(result.matchId, MATCH_ID)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, PA1)
  assert.equal(urls.filter((u) => u.includes('/api/duel/matches')).length, 1)
  assert.equal(urls.filter((u) => u === '/api/duel/matches').length, 0)
}

/* createDuelALockCoordinator still used for TOP create (smoke) */
{
  const storage = new MemoryStorage()
  const urls: string[] = []
  await createDuelALockCoordinator({
    storage,
    fetch: async (input) => {
      urls.push(String(input))
      if (String(input) === '/api/duel/matches') {
        return json(
          {
            matchId: MATCH_ID,
            totalRounds: 1,
            participant: { role: 'A', token: PA1 },
            invitation: { token: `3cb_pi1_${'c'.repeat(42)}A` },
          },
          201,
        )
      }
      if (String(input).endsWith('/placements/lock')) {
        return json({ matchId: MATCH_ID, role: 'A', placementLocked: true })
      }
      return json({
        matchId: MATCH_ID,
        totalRounds: 1,
        role: 'A',
        self: { claimed: true, placementLocked: true },
        opponent: { claimed: false, placementLocked: false },
      })
    },
    crypto: {
      randomUUID: () => MATCH_ID as `${string}-${string}-${string}-${string}-${string}`,
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array instanceof Uint8Array) array.fill(1)
        return array
      },
    },
  }).run({
    totalRounds: 1,
    placements: [
      {
        roundNumber: 1,
        bagCount: 3,
        bombBagId: 'bag-3',
        coinCountsByBag: { 'bag-1': 2, 'bag-2': 1 },
      },
    ],
  })
  assert(urls.includes('/api/duel/matches'))
}

/* A resume coordinator never POSTs /matches */
{
  const storage = new MemoryStorage()
  storage.setItem(
    `3cb:duel:v1:participant:${MATCH_ID}`,
    JSON.stringify({ version: 1, matchId: MATCH_ID, role: 'A', token: PA1 }),
  )
  const urls: string[] = []
  await createDuelParticipantLockCoordinator({
    storage,
    fetch: async (input) => {
      urls.push(String(input))
      if (String(input) === '/api/duel/matches') assert.fail('create forbidden')
      if (String(input).endsWith('/placements/lock')) {
        return json({ matchId: MATCH_ID, role: 'A', placementLocked: true })
      }
      return json({
        matchId: MATCH_ID,
        totalRounds: 1,
        role: 'A',
        self: { claimed: true, placementLocked: true },
        opponent: { claimed: false, placementLocked: false },
      })
    },
  }).run({
    matchId: MATCH_ID,
    totalRounds: 1,
    role: 'A',
    placements: [
      {
        roundNumber: 1,
        bagCount: 3,
        bombBagId: 'bag-3',
        coinCountsByBag: { 'bag-1': 2, 'bag-2': 1 },
      },
    ],
  })
  assert(!urls.includes('/api/duel/matches'))
}

const [bootstrap, flow, lockSource, createLock] = await Promise.all([
  readFile('src/components/DuelClaimBootstrap.tsx', 'utf8'),
  readFile('src/components/DuelFlow.tsx', 'utf8'),
  readFile('src/duel/duelParticipantLock.ts', 'utf8'),
  readFile('src/duel/duelCreateLock.ts', 'utf8'),
])

assert.match(bootstrap, /participantA=\{\{/)
assert.match(bootstrap, /totalRounds: result\.state\.totalRounds/)
assert.match(bootstrap, /kind === 'participant-a'/)
// Unlocked A must not route straight to InvitePanel anymore.
assert.doesNotMatch(
  bootstrap,
  /participant-a'\) \{\s*return \(\s*<DuelBootstrapShell[^>]*>\s*<DuelInvitePanel/,
)

assert.match(flow, /participantA\?:/)
assert.match(flow, /createDuelParticipantLockCoordinator/)
assert.match(flow, /createDuelALockCoordinator/)
assert.match(flow, /existingRole/)
// Existing-match path uses participant lock; TOP create stays on create coordinator.
assert.match(flow, /useParticipantLock/)
assert.match(
  flow,
  /if \(useParticipantLock\) \{[\s\S]*createDuelParticipantLockCoordinator\([\s\S]*\} else \{[\s\S]*createDuelALockCoordinator\(/,
)

assert.match(lockSource, /createDuelParticipantLockCoordinator/)
assert.match(lockSource, /createDuelBLockCoordinator/)
assert.doesNotMatch(lockSource, /fetch\('\/api\/duel\/matches'/)
assert.doesNotMatch(lockSource, /fetch\("\/api\/duel\/matches"/)
assert.match(createLock, /export function createDuelALockCoordinator/)

/* LOCK failure copy: existing-match path ≠ create-only message. */
const [jaSource, enSource] = await Promise.all([
  readFile('src/i18n/ja.ts', 'utf8'),
  readFile('src/i18n/en.ts', 'utf8'),
])
assert.match(flow, /duelPlacementLockError/)
assert.match(flow, /lockErrorKind/)
assert.match(flow, /useParticipantLock \? 'placement' : 'create'/)
assert.match(jaSource, /配置のロックに失敗しました/)
assert.match(enSource, /Could not lock the placements/)
assert.match(jaSource, /対戦の作成に失敗しました/)
assert.match(enSource, /Could not create the match/)

console.log('verify-duel-a-placement-resume-client: all checks passed')
