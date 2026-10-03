/**
 * Pure / coordinator checks for A unlocked #p existing-match placement resume.
 */
import assert from 'node:assert/strict'
import {
  createDuelParticipantLockCoordinator,
  DuelParticipantLockError,
} from '../src/duel/duelParticipantLock'
import {
  DUEL_PENDING_LOCK_KEY,
  invitationStorageKey,
  participantStorageKey,
  readARecoveryState,
  readParticipant,
  readParticipantLockRecovery,
  type StorageAdapter,
} from '../src/duel/duelPersistence'
import type { DuelRoundPlacement } from '../src/game/duelPlacement'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const A_TOKEN = `3cb_pa1_${'a'.repeat(42)}A`
const B_TOKEN = `3cb_pb1_${'b'.repeat(42)}A`

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

const placements: readonly DuelRoundPlacement[] = [
  {
    roundNumber: 1,
    bagCount: 3,
    bombBagId: 'bag-3',
    coinCountsByBag: { 'bag-1': 2, 'bag-2': 1 },
  },
]

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function aState(placementLocked = true) {
  return {
    matchId: MATCH_ID,
    totalRounds: 1,
    role: 'A',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked },
    opponent: { claimed: false, placementLocked: false },
  }
}

function setA(storage: MemoryStorage) {
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role: 'A', token: A_TOKEN }),
  )
}

/* 1. A existing-match LOCK: no create, no invitation, same matchId + pa1 */
{
  const storage = new MemoryStorage()
  setA(storage)
  const urls: string[] = []
  await createDuelParticipantLockCoordinator({
    storage,
    fetch: async (input, init) => {
      const url = String(input)
      urls.push(url)
      if (url === '/api/duel/matches') assert.fail('A resume must not create')
      if (url.endsWith('/placements/lock')) {
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          `Bearer ${A_TOKEN}`,
        )
        return json({ matchId: MATCH_ID, role: 'A', placementLocked: true })
      }
      return json(aState(true))
    },
  }).run({
    matchId: MATCH_ID,
    totalRounds: 1,
    placements,
    role: 'A',
  })
  assert.deepEqual(urls, [
    `/api/duel/matches/${MATCH_ID}/placements/lock`,
    `/api/duel/matches/${MATCH_ID}`,
  ])
  assert.equal(storage.getItem(DUEL_PENDING_LOCK_KEY), null)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, A_TOKEN)
  assert.equal(storage.getItem(invitationStorageKey(MATCH_ID)), null)
}

/* 2. response-lost → pending-lock retry; still no create; exact retry path */
{
  const storage = new MemoryStorage()
  setA(storage)
  let lockAttempts = 0
  let createCalls = 0
  const coordinator = createDuelParticipantLockCoordinator({
    storage,
    fetch: async (input) => {
      const url = String(input)
      if (url === '/api/duel/matches') {
        createCalls += 1
        return json({})
      }
      if (url.endsWith('/placements/lock')) {
        lockAttempts += 1
        if (lockAttempts === 1) throw new Error('lost')
        return json({ matchId: MATCH_ID, role: 'A', placementLocked: true })
      }
      return json(aState(true))
    },
  })
  await assert.rejects(
    () =>
      coordinator.run({
        matchId: MATCH_ID,
        totalRounds: 1,
        placements,
        role: 'A',
      }),
    DuelParticipantLockError,
  )
  assert.equal(readParticipantLockRecovery(storage, MATCH_ID, 'A').phase, 'lock-retry')
  assert.equal(readARecoveryState(storage).phase, 'idle')
  await coordinator.run({
    matchId: MATCH_ID,
    totalRounds: 1,
    placements,
    role: 'A',
  })
  assert.equal(createCalls, 0)
  assert.equal(lockAttempts, 2)
  assert.equal(storage.getItem(DUEL_PENDING_LOCK_KEY), null)
}

/* 3. wrong role in LS must not succeed as A */
{
  const storage = new MemoryStorage()
  storage.setItem(
    participantStorageKey(MATCH_ID),
    JSON.stringify({ version: 1, matchId: MATCH_ID, role: 'B', token: B_TOKEN }),
  )
  await assert.rejects(
    () =>
      createDuelParticipantLockCoordinator({
        storage,
        fetch: async () => json({}),
      }).run({
        matchId: MATCH_ID,
        totalRounds: 1,
        placements,
        role: 'A',
      }),
    (error: unknown) =>
      error instanceof DuelParticipantLockError && error.code === 'REQUEST_FAILED',
  )
}

/* 4. GET confirm with wrong role must not succeed */
{
  const storage = new MemoryStorage()
  setA(storage)
  await assert.rejects(
    () =>
      createDuelParticipantLockCoordinator({
        storage,
        fetch: async (input) => {
          if (String(input).endsWith('/placements/lock')) {
            return json({ matchId: MATCH_ID, role: 'A', placementLocked: true })
          }
          return json({ ...aState(true), role: 'B' })
        },
      }).run({
        matchId: MATCH_ID,
        totalRounds: 1,
        placements,
        role: 'A',
      }),
    DuelParticipantLockError,
  )
}

console.log('verify-duel-a-placement-resume: all checks passed')
