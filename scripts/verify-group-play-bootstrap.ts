/** GROUP authenticated bootstrap, placements, start, resume, and client checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGroupPlayHandler } from '../api/group/matches/[groupId]/play.ts'
import { createGroupPlacementsHandler } from '../api/group/matches/[groupId]/placements.ts'
import { createStartGroupRoundHandler } from '../api/group/matches/[groupId]/rounds/start.ts'
import { createResumeGroupPlayHandler } from '../api/group/matches/[groupId]/play/resume.ts'
import {
  GROUP_PARTICIPANT_TOKEN_PREFIX,
  hashGroupCapability,
} from '../server/auth/groupTokens.ts'
import {
  GroupPlayError,
  beginGroupRound,
  explicitlyResumeGroupPlay,
  readGroupPlayPlacements,
  readGroupPlayState,
  validateGroupPlayAuth,
  validateGroupPlayCommand,
} from '../server/group/play.ts'
import {
  createGroupPlayBootstrapCoordinator,
  createGroupPlayClient,
  GroupPlayClientError,
  parseGroupPlacementSet,
  parseGroupPlayState,
} from '../src/group/groupPlayClient.ts'
import { groupParticipantStorageKey, type GroupStorageAdapter } from '../src/group/groupPersistence.ts'

const root = resolve(import.meta.dirname, '..')
const groupId = '123e4567-e89b-42d3-a456-426614174000'
const otherGroupId = '223e4567-e89b-42d3-a456-426614174000'
const participantId = '323e4567-e89b-42d3-a456-426614174000'
const requestId = '423e4567-e89b-42d3-a456-426614174000'
const token = `${GROUP_PARTICIPANT_TOKEN_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
const auth = validateGroupPlayAuth(groupId, `Bearer ${token}`)
assert.equal(auth.groupId, groupId)
assert.equal(auth.participantTokenHash, hashGroupCapability(token))
assert.throws(() => validateGroupPlayAuth(groupId, null), GroupPlayError)
assert.throws(() => validateGroupPlayAuth(groupId, 'Bearer invalid'), GroupPlayError)
const otherMatchAuth = validateGroupPlayAuth(otherGroupId, `Bearer ${token}`)
await assert.rejects(
  () => readGroupPlayState(otherMatchAuth, { getState: async () => null }),
  GroupPlayError,
)
assert.equal(validateGroupPlayCommand(groupId, `Bearer ${token}`, requestId).requestId, requestId)

const initialState = {
  groupId,
  totalRounds: 2,
  groupStatus: 'open' as const,
  participant: { id: participantId, displayNickname: '桃3', completed: false, excluded: false },
  completedRounds: 0,
  nextRoundNumber: 1,
  activeAttempt: null,
}
const activeState = {
  ...initialState,
  nextRoundNumber: 1,
  activeAttempt: { roundNumber: 1, startedAt: '2026-10-07T00:00:00.000Z', openedBagCount: 0 },
}
const interruptedState = { ...initialState, completedRounds: 1, nextRoundNumber: 2 }
const placements = {
  groupId,
  totalRounds: 2,
  formationVersion: 1,
  ruleVersion: 1,
  placements: [
    { roundNumber: 1, bagCount: 4, bombBagNumber: 4, coinBagNumbers: [1, 2, 2] as [number, number, number] },
    { roundNumber: 2, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [1, 1, 3] as [number, number, number] },
  ],
}

assert.deepEqual(await readGroupPlayState(auth, { getState: async () => initialState }), initialState)
assert.deepEqual(await readGroupPlayPlacements(auth, { getPlacements: async () => placements }), placements)
assert.deepEqual(await beginGroupRound({ ...auth, requestId }, { start: async () => activeState }), activeState)
assert.deepEqual(await explicitlyResumeGroupPlay({ ...auth, requestId }, { resume: async () => interruptedState }), interruptedState)
await assert.rejects(() => beginGroupRound({ ...auth, requestId }, { start: async () => null }), (error: unknown) => error instanceof GroupPlayError && error.code === 'CANNOT_START')
await assert.rejects(() => readGroupPlayPlacements(auth, { getPlacements: async () => ({ ...placements, placements: placements.placements.slice(0, 1) }) }), GroupPlayError)

const playResponse = await createGroupPlayHandler(async () => initialState)(new Request(`https://example.test/api/group/matches/${groupId}/play`, { headers: { Authorization: `Bearer ${token}` } }))
assert.equal(playResponse.status, 200); assert.equal(playResponse.headers.get('cache-control'), 'no-store')
const placementResponse = await createGroupPlacementsHandler(async () => placements)(new Request(`https://example.test/api/group/matches/${groupId}/placements`, { headers: { Authorization: `Bearer ${token}` } }))
assert.equal(placementResponse.status, 200); assert.equal(placementResponse.headers.get('cache-control'), 'no-store')
const startResponse = await createStartGroupRoundHandler(async () => activeState)(new Request(`https://example.test/api/group/matches/${groupId}/rounds/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': requestId } }))
assert.equal(startResponse.status, 200)
const resumeResponse = await createResumeGroupPlayHandler(async () => interruptedState)(new Request(`https://example.test/api/group/matches/${groupId}/play/resume`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': requestId } }))
assert.equal(resumeResponse.status, 200)
for (const response of [playResponse, placementResponse, startResponse, resumeResponse]) {
  const text = await response.clone().text()
  assert.equal(text.includes(token), false)
  assert.equal(text.includes('authTokenHash'), false)
}

assert.deepEqual(parseGroupPlayState(activeState, groupId), activeState)
assert.deepEqual(parseGroupPlacementSet(placements, groupId), placements)
assert.throws(() => parseGroupPlayState({ ...activeState, groupId: otherGroupId }, groupId), GroupPlayClientError)
assert.throws(() => parseGroupPlacementSet({ ...placements, placements: placements.placements.slice(0, 1) }, groupId), GroupPlayClientError)
assert.throws(() => parseGroupPlacementSet({ ...placements, placements: [placements.placements[1], placements.placements[0]] }, groupId), GroupPlayClientError)

class MemoryStorage implements GroupStorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  assert.ok(init?.headers)
  return init.headers as Record<string, string>
}
const storage = new MemoryStorage()
storage.setItem(groupParticipantStorageKey(groupId), JSON.stringify({ version: 1, groupId, participantId, displayNickname: '桃3', token, acceptedAt: '2026-10-07T00:00:00.000Z' }))
const calls: string[] = []
let starts = 0
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input); calls.push(`${init?.method}:${url}`)
  assert.equal(requestHeaders(init).Authorization, `Bearer ${token}`)
  if (url.endsWith('/play')) return Response.json(initialState)
  if (url.endsWith('/placements')) return Response.json(placements)
  if (url.endsWith('/rounds/start')) { starts += 1; assert.match(requestHeaders(init)['Idempotency-Key']!, UUID_V4_LOCAL); return Response.json(activeState) }
  if (url.endsWith('/play/resume')) return Response.json(interruptedState)
  return new Response('', { status: 404 })
}
const UUID_V4_LOCAL = /^[0-9a-f-]{36}$/i
let ids = 0
const client = createGroupPlayClient({ storage, fetch: fetcher, crypto: { randomUUID: () => `${String(++ids).padStart(8, '0')}-0000-4000-8000-000000000000` as `${string}-${string}-${string}-${string}-${string}` } })
const coordinator = createGroupPlayBootstrapCoordinator(client)
const ready = await coordinator.run(groupId, false)
assert.equal(ready.currentPlacement.roundNumber, 1)
assert.equal(starts, 1)
assert.deepEqual(calls, [`GET:/api/group/matches/${groupId}/play`, `GET:/api/group/matches/${groupId}/placements`, `POST:/api/group/matches/${groupId}/rounds/start`])

const resumeCalls: string[] = []
const resumeClient = createGroupPlayClient({ storage, crypto: { randomUUID: () => requestId as `${string}-${string}-${string}-${string}-${string}` }, fetch: async (input, init) => {
  const url = String(input); resumeCalls.push(`${init?.method}:${url}`)
  if (url.endsWith('/play/resume')) return Response.json(interruptedState)
  if (url.endsWith('/placements')) return Response.json(placements)
  if (url.endsWith('/rounds/start')) return Response.json({ ...activeState, completedRounds: 1, nextRoundNumber: 2, activeAttempt: { ...activeState.activeAttempt!, roundNumber: 2 } })
  return new Response('', { status: 404 })
} })
const resumed = await createGroupPlayBootstrapCoordinator(resumeClient).run(groupId, true)
assert.equal(resumed.state.activeAttempt?.roundNumber, 2)
assert.equal(resumeCalls[0], `POST:/api/group/matches/${groupId}/play/resume`)

let startAttempts = 0
const retryIds: string[] = []
const retryClient = createGroupPlayClient({ storage, crypto: { randomUUID: () => requestId as `${string}-${string}-${string}-${string}-${string}` }, fetch: async (input, init) => {
  const url = String(input)
  if (url.endsWith('/play')) return Response.json(initialState)
  if (url.endsWith('/placements')) return Response.json(placements)
  if (url.endsWith('/rounds/start')) {
    startAttempts += 1
    retryIds.push(requestHeaders(init)['Idempotency-Key']!)
    return startAttempts === 1 ? new Response('', { status: 503 }) : Response.json(activeState)
  }
  return new Response('', { status: 404 })
} })
const retryCoordinator = createGroupPlayBootstrapCoordinator(retryClient)
await assert.rejects(() => retryCoordinator.run(groupId, false), GroupPlayClientError)
assert.equal((await retryCoordinator.run(groupId, false)).state.activeAttempt?.roundNumber, 1)
assert.deepEqual(retryIds, [requestId, requestId])

const dbSource = readFileSync(resolve(root, 'server/db/groupPlay.ts'), 'utf8')
assert.match(dbSource, /participant\.auth_token_hash/)
assert.match(dbSource, /for update/)
assert.match(dbSource, /status = 'interrupted'/)
assert.match(dbSource, /captured_coins = 0/)
assert.match(dbSource, /opened_bag_count/)
assert.match(dbSource, /match\.status = 'open'/)
assert.match(dbSource, /participant\.excluded_at is null/)
assert.match(dbSource, /participant\.completed_at is null/)
assert.match(dbSource, /progress\.terminal_count \+ 1/)
const clientSource = readFileSync(resolve(root, 'src/group/groupPlayClient.ts'), 'utf8')
for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'server/db']) assert.equal(clientSource.includes(forbidden), false)
const uiSource = readFileSync(resolve(root, 'src/components/GroupEntryShell.tsx'), 'utf8')
assert.match(uiSource, /GroupPlayScreen/)
assert.doesNotMatch(uiSource, /cashOut/)
assert.match(uiSource, /explicitResumeRef\.current \?\?=/)

console.log('verify:group-play-bootstrap OK')
