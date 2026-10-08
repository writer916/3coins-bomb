/** GROUP nickname join/resume, participant persistence, and route checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createJoinGroupParticipantHandler } from '../api/_group/matches/[groupId]/join.ts'
import {
  GROUP_PARTICIPANT_TOKEN_PREFIX,
  deriveGroupCreationCapabilities,
  deriveGroupParticipantCapability,
  hashGroupCapability,
} from '../server/auth/groupTokens.ts'
import {
  JoinGroupParticipantError,
  joinGroupParticipant,
  validateJoinGroupParticipantRequest,
} from '../server/group/joinParticipant.ts'
import {
  createGroupJoinCoordinator,
  GroupJoinClientError,
} from '../src/group/groupJoinClient.ts'
import { createGroupHostUrl } from '../src/group/groupInvitation.ts'
import {
  groupHostStorageKey,
  groupParticipantStorageKey,
  readGroupHost,
  readGroupParticipant,
  type GroupStorageAdapter,
} from '../src/group/groupPersistence.ts'

const root = resolve(import.meta.dirname, '..')
const groupId = '123e4567-e89b-42d3-a456-426614174000'
const participantId = '223e4567-e89b-42d3-a456-426614174000'
const env = { DUEL_TOKEN_HMAC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
const creation = deriveGroupCreationCapabilities(groupId, env)
const participantToken = deriveGroupParticipantCapability(groupId, '桃3', env)

assert.match(participantToken, new RegExp(`^${GROUP_PARTICIPANT_TOKEN_PREFIX}`))
assert.equal(participantToken, deriveGroupParticipantCapability(groupId, '桃3', env))
assert.notEqual(participantToken, deriveGroupParticipantCapability(groupId, '桃4', env))
assert.notEqual(participantToken, creation.invitationToken)
assert.equal(hashGroupCapability(participantToken).length, 64)

const valid = validateJoinGroupParticipantRequest(groupId, {
  invitationToken: creation.invitationToken,
  nickname: '桃3',
})
assert.deepEqual(valid, {
  groupId,
  invitationToken: creation.invitationToken,
  hostToken: null,
  displayNickname: '桃3',
  nicknameKey: '桃3',
})
const withHost = validateJoinGroupParticipantRequest(groupId, {
  invitationToken: creation.invitationToken,
  nickname: 'Cafe\u0301',
  hostToken: creation.hostToken,
})
assert.equal(withHost.nicknameKey, 'Café')
assert.equal(withHost.displayNickname, 'Cafe\u0301')
for (const nickname of ['', 'A B', '🙂', 'A!', 'Ａ']) {
  assert.throws(
    () => validateJoinGroupParticipantRequest(groupId, {
      invitationToken: creation.invitationToken,
      nickname,
    }),
    JoinGroupParticipantError,
  )
}
assert.throws(() => validateJoinGroupParticipantRequest(groupId, {
  invitationToken: creation.invitationToken,
  nickname: 'Valid',
  extra: true,
}), JoinGroupParticipantError)

const acceptedAt = '2026-10-07T00:00:00.000Z'
let capturedHash = ''
const first = await joinGroupParticipant(valid, {
  deriveParticipantToken: () => participantToken,
  persist: async (input) => {
    capturedHash = input.authTokenHash
    assert.equal(input.hostTokenHash, null)
    assert.notEqual(input.invitationTokenHash, input.invitationToken)
    return {
      groupId,
      participantId,
      displayNickname: '桃3',
      acceptedAt,
      completedAt: null,
      excludedAt: null,
      participantVersion: 0,
      totalRounds: 3,
      playerLimit: 8,
      groupStatus: 'open',
      joined: true,
      isHost: false,
    }
  },
})
assert.equal(first.joined, true)
assert.equal(first.response.participant.token, participantToken)
assert.equal(capturedHash, hashGroupCapability(participantToken))
assert.equal(JSON.stringify(first.response).includes(capturedHash), false)
assert.deepEqual(Object.keys(first.response).sort(), [
  'groupId', 'hostAuthenticated', 'participant', 'playerLimit', 'status', 'totalRounds',
].sort())

await assert.rejects(
  () => joinGroupParticipant(valid, {
    deriveParticipantToken: () => participantToken,
    persist: async () => { throw Object.assign(new Error('atomic'), { code: '22012' }) },
  }),
  (error: unknown) => error instanceof JoinGroupParticipantError && error.code === 'JOIN_UNAVAILABLE',
)
await assert.rejects(
  () => joinGroupParticipant(valid, {
    deriveParticipantToken: () => participantToken,
    persist: async () => {
      throw Object.assign(new Error('query'), {
        cause: Object.assign(new Error('atomic'), { code: '22012' }),
      })
    },
  }),
  (error: unknown) => error instanceof JoinGroupParticipantError && error.code === 'JOIN_UNAVAILABLE',
)
await assert.rejects(
  () => joinGroupParticipant(valid, {
    deriveParticipantToken: () => participantToken,
    persist: async () => { throw Object.assign(new Error('database'), { code: 'XX000' }) },
  }),
  /database/,
)

const handler = createJoinGroupParticipantHandler(async () => ({ ...first, joined: true }))
const routeResponse = await handler(new Request(
  `https://example.test/api/group/matches/${groupId}/join`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitationToken: creation.invitationToken, nickname: '桃3' }),
  },
))
assert.equal(routeResponse.status, 201)
assert.equal(routeResponse.headers.get('cache-control'), 'no-store')
assert.deepEqual(await routeResponse.json(), first.response)
const resumedResponse = await createJoinGroupParticipantHandler(async () => ({
  ...first,
  joined: false,
}))(new Request(`https://example.test/api/group/matches/${groupId}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ invitationToken: creation.invitationToken, nickname: '桃3' }),
}))
assert.equal(resumedResponse.status, 200)
const conflict = await createJoinGroupParticipantHandler(async () => {
  throw new JoinGroupParticipantError('JOIN_UNAVAILABLE')
})(new Request(`https://example.test/api/group/matches/${groupId}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ invitationToken: creation.invitationToken, nickname: '桃3' }),
}))
assert.equal(conflict.status, 409)
assert.equal(JSON.stringify(await conflict.json()).includes(participantToken), false)

class MemoryStorage implements GroupStorageAdapter {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
const storage = new MemoryStorage()
storage.setItem(groupHostStorageKey(groupId), JSON.stringify({
  version: 1,
  groupId,
  invitationToken: creation.invitationToken,
  hostToken: creation.hostToken,
  totalRounds: 3,
  playerLimit: 8,
  formationVersion: 1,
  ruleVersion: 1,
  scoringVersion: 1,
}))
let requests = 0
let body: Record<string, unknown> | null = null
let resolveFetch!: (value: Response) => void
const responsePromise = new Promise<Response>((resolve) => { resolveFetch = resolve })
const coordinator = createGroupJoinCoordinator({
  storage,
  fetch: async (_input, init) => {
    requests += 1
    assert.equal(init?.method, 'POST')
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return responsePromise
  },
})
const invitationUrl = `https://example.test/group/${groupId}#invite=${creation.invitationToken}`
const run1 = coordinator.run(invitationUrl, '桃3')
const run2 = coordinator.run(invitationUrl, '桃3')
assert.equal(run1, run2)
resolveFetch(Response.json(first.response, { status: 201 }))
const clientResult = await run1
assert.equal(requests, 1)
assert.equal(body?.hostToken, creation.hostToken)
assert.equal(body?.invitationToken, creation.invitationToken)
assert.equal(clientResult.participant.displayNickname, '桃3')
assert.deepEqual(readGroupParticipant(storage, groupId), clientResult.participant)
assert.notEqual(groupParticipantStorageKey(groupId), groupHostStorageKey(groupId))

const guestStorage = new MemoryStorage()
let guestBody: Record<string, unknown> | null = null
await createGroupJoinCoordinator({
  storage: guestStorage,
  fetch: async (_input, init) => {
    guestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json(first.response, { status: 200 })
  },
}).run(invitationUrl, '桃3')
assert.equal('hostToken' in (guestBody ?? {}), false)
await assert.rejects(
  () => createGroupJoinCoordinator({
    storage: new MemoryStorage(),
    fetch: async () => new Response('', { status: 409 }),
  }).run(invitationUrl, '桃3'),
  (error: unknown) => error instanceof GroupJoinClientError && error.code === 'JOIN_UNAVAILABLE',
)

/** Host personal URL on a clean device (no prior localStorage host). */
const coldHostStorage = new MemoryStorage()
const hostPersonalUrl = createGroupHostUrl(
  'https://example.test',
  groupId,
  creation.hostToken,
  creation.invitationToken,
)
assert.match(hostPersonalUrl, /#host=/)
assert.notEqual(hostPersonalUrl, invitationUrl)
let coldHostBody: Record<string, unknown> | null = null
const hostJoinResponse = {
  ...first.response,
  hostAuthenticated: true,
}
const coldHostResult = await createGroupJoinCoordinator({
  storage: coldHostStorage,
  fetch: async (_input, init) => {
    coldHostBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json(hostJoinResponse, { status: 201 })
  },
}).run(hostPersonalUrl, '桃3')
assert.equal(coldHostBody?.hostToken, creation.hostToken)
assert.equal(coldHostBody?.invitationToken, creation.invitationToken)
assert.equal(coldHostResult.hostAuthenticated, true)
assert.deepEqual(readGroupHost(coldHostStorage, groupId), {
  version: 1,
  groupId,
  invitationToken: creation.invitationToken,
  hostToken: creation.hostToken,
  totalRounds: 3,
  playerLimit: 8,
  formationVersion: 1,
  ruleVersion: 1,
  scoringVersion: 1,
})
assert.deepEqual(readGroupParticipant(coldHostStorage, groupId), coldHostResult.participant)

/** Invite URL alone must not restore host authority from nickname. */
const nicknameOnlyStorage = new MemoryStorage()
let nicknameOnlyBody: Record<string, unknown> | null = null
await createGroupJoinCoordinator({
  storage: nicknameOnlyStorage,
  fetch: async (_input, init) => {
    nicknameOnlyBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json(first.response, { status: 200 })
  },
}).run(invitationUrl, '桃3')
assert.equal('hostToken' in (nicknameOnlyBody ?? {}), false)
assert.equal(readGroupHost(nicknameOnlyStorage, groupId), null)

/** Host URL with failed host auth must not persist host capability. */
const badHostStorage = new MemoryStorage()
await createGroupJoinCoordinator({
  storage: badHostStorage,
  fetch: async () => Response.json(first.response, { status: 200 }),
}).run(hostPersonalUrl, '桃3')
assert.equal(readGroupHost(badHostStorage, groupId), null)

const dbSource = readFileSync(resolve(root, 'server/db/joinGroupParticipant.ts'), 'utf8')
assert.match(dbSource, /accepted_count = match\.accepted_count \+ case/)
assert.match(dbSource, /match\.accepted_count < match\.player_limit/)
assert.match(dbSource, /on conflict \(group_id, nickname_key\) do update/)
assert.match(dbSource, /invite_token_hash = \$\{input\.invitationTokenHash\}\s+for update/)
assert.match(dbSource, /match\.status = 'open'/)
assert.match(dbSource, /match\.host_participant_id is null/)
assert.match(dbSource, /or match\.host_participant_id = participant\.id/)
assert.equal((dbSource.match(/getDatabase\(\)\.execute/g) ?? []).length, 1)
const clientSource = readFileSync(resolve(root, 'src/group/groupJoinClient.ts'), 'utf8')
for (const persistence of ['sessionStorage', 'indexedDB']) {
  assert.equal(clientSource.includes(persistence), false)
}
const uiSource = readFileSync(resolve(root, 'src/components/GroupEntryShell.tsx'), 'utf8')
assert.match(uiSource, /groupNicknameLabel/)
assert.match(uiSource, /groupJoin/)
assert.doesNotMatch(uiSource, />\s*PLAY\s*</)

console.log('verify:group-join OK')
