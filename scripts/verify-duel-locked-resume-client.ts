/**
 * Source / bootstrap wiring checks for LOCK-after resume routing.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createDuelClaimBootstrapCoordinator,
} from '../src/duel/duelClaim'
import { readParticipant, type StorageAdapter } from '../src/duel/duelPersistence'

const MATCH_ID = '11111111-1111-4111-8111-111111111111'
const PA1 = `3cb_pa1_${'a'.repeat(42)}A`
const PI1 = `3cb_pi1_${'b'.repeat(42)}A`
const CREATED_AT = '2026-01-01T00:00:00.000Z'
const P_URL = `https://example.test/duel/${MATCH_ID}#p=${PA1}`
const INVITE_URL = `https://example.test/duel/${MATCH_ID}#invite=${PI1}`

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

function matchBody(
  role: 'A' | 'B',
  selfLocked: boolean,
  opponentLocked: boolean,
  opponentClaimed = true,
) {
  return {
    matchId: MATCH_ID,
    totalRounds: 1,
    role,
    createdAt: CREATED_AT,
    expiresAt: null,
    formationVersion: 1,
    ruleVersion: 1,
    self: { claimed: true, placementLocked: selfLocked },
    opponent: { claimed: opponentClaimed, placementLocked: opponentLocked },
  }
}

/* A #p locked / opponent unlocked — auth GET reused; no /result */
{
  const storage = new MemoryStorage()
  const history: string[] = []
  const urls: string[] = []
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: {
      replaceState(_d, _u, url) {
        history.push(String(url))
      },
    },
    crypto: { getRandomValues: (arr) => arr },
    fetch: async (input) => {
      urls.push(String(input))
      return json(matchBody('A', true, false, false))
    },
  }).run(P_URL)
  assert.equal(result.kind, 'participant-a')
  assert.equal(result.state.self.placementLocked, true)
  assert.equal(result.state.opponent.placementLocked, false)
  assert.equal(urls.filter((u) => u.endsWith(`/matches/${MATCH_ID}`)).length, 1)
  assert.equal(urls.filter((u) => u.endsWith('/result')).length, 0)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, PA1)
}

/* B #invite locked both + completed → state available; GET match then client may result */
{
  const storage = new MemoryStorage()
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: { getRandomValues: (arr) => arr },
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/claim')) assert.fail('claimed B must not claim again')
      return json(matchBody('B', true, true, true))
    },
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(result.state.self.placementLocked, true)
  assert.equal(readParticipant(storage, MATCH_ID)?.token, PI1)
}

/* B unlocked after claim-style GET → placement path (no forced locked resume) */
{
  const storage = new MemoryStorage()
  const result = await createDuelClaimBootstrapCoordinator({
    storage,
    history: { replaceState() {} },
    crypto: { getRandomValues: (arr) => arr },
    fetch: async () => json(matchBody('B', false, true, true)),
  }).run(INVITE_URL)
  assert.equal(result.kind, 'participant-b')
  assert.equal(result.state.self.placementLocked, false)
}

const [
  bootstrap,
  lockedResume,
  invitePanel,
  capability,
  claim,
] = await Promise.all([
  readFile('src/components/DuelClaimBootstrap.tsx', 'utf8'),
  readFile('src/duel/duelLockedResume.ts', 'utf8'),
  readFile('src/components/DuelInvitePanel.tsx', 'utf8'),
  readFile('src/duel/duelParticipantCapability.ts', 'utf8'),
  readFile('src/duel/duelClaim.ts', 'utf8'),
])

assert.match(bootstrap, /resolveDuelLockedResume/)
assert.match(bootstrap, /lockedResume/)
assert.match(bootstrap, /DuelResultScreen/)
assert.match(bootstrap, /DuelPlayScreen/)
assert.match(bootstrap, /placementLocked/)
assert.match(bootstrap, /initiallyLocked=\{false\}/)
assert.doesNotMatch(bootstrap, /#p=.*#invite=|pb1_/)

assert.match(lockedResume, /duelResumeNeedsCompletionSnapshot/)
assert.match(lockedResume, /fetchResult/)
assert.match(lockedResume, /waiting-for-opponent-lock/)
assert.match(lockedResume, /waiting-for-opponent-complete/)
assert.match(lockedResume, /result-ready/)
assert.match(invitePanel, /!inviteUrl && selfUrl/)
assert.doesNotMatch(invitePanel, /deriveParticipant|createDuelInvitationUrl\(/)

assert.match(capability, /kind: authenticated\.role === 'A' \? 'participant-a'/)
assert.match(claim, /role: imported\.kind === 'participant-a' \? 'A' : 'B'/)
assert.doesNotMatch(claim, /deriveParticipantBToken/)

// Ensure invite panel wait-without-invite does not clear LS keys
assert.doesNotMatch(invitePanel, /removeItem\(|localStorage\.clear/)

console.log('verify-duel-locked-resume-client: all checks passed')
