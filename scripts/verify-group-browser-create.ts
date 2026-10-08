/** GROUP browser create, persistence, invitation URL and route checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createGroupCreateCoordinator,
  GroupCreateClientError,
} from '../src/group/groupCreateClient'
import {
  createGroupHostUrl,
  createGroupInvitationUrl,
  classifyGroupUrlFragment,
  GroupInvitationUrlError,
  isGroupRouteUrl,
  parseGroupHostUrl,
  parseGroupInvitationUrl,
} from '../src/group/groupInvitation'
import {
  GROUP_PENDING_CREATE_KEY,
  completeGroupCreate,
  createPendingGroupCreate,
  groupHostStorageKey,
  readGroupHost,
  readPendingGroupCreate,
  savePendingGroupCreate,
  type GroupStorageAdapter,
} from '../src/group/groupPersistence'

const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const INVITE = `3cb_gi1_${'a'.repeat(42)}A`
const HOST = `3cb_gh1_${'b'.repeat(42)}A`
const ORIGIN = 'https://example.test'

class MemoryStorage implements GroupStorageAdapter {
  readonly values = new Map<string, string>()
  readonly events: string[] = []
  failSet = false
  failRemove = false
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('write failed')
    this.values.set(key, value)
    this.events.push(`set:${key}`)
  }
  removeItem(key: string): void {
    if (this.failRemove) throw new Error('remove failed')
    this.values.delete(key)
    this.events.push(`remove:${key}`)
  }
}

const cryptoFixture = {
  randomUUID: () => REQUEST_ID as `${string}-${string}-${string}-${string}-${string}`,
}
const responseBody = {
  groupId: GROUP_ID,
  totalRounds: 3,
  playerLimit: 8,
  invitation: { token: INVITE },
  host: { token: HOST },
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  formationVersion: 1,
  ruleVersion: 1,
  scoringVersion: 1,
}
function json(value: unknown, status = 201): Response {
  return Response.json(value, { status })
}
function expectSafeError(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert(error instanceof Error)
    assert(!error.message.includes(INVITE))
    assert(!error.message.includes(HOST))
    return true
  })
}

const pending = createPendingGroupCreate(3, 8, cryptoFixture)
assert.deepEqual(pending, {
  version: 1,
  phase: 'pending-create',
  createRequestId: REQUEST_ID,
  totalRounds: 3,
  playerLimit: 8,
})
const pendingStorage = new MemoryStorage()
savePendingGroupCreate(pendingStorage, pending)
assert.deepEqual(readPendingGroupCreate(pendingStorage), pending)
pendingStorage.values.set(GROUP_PENDING_CREATE_KEY, '{broken')
expectSafeError(() => readPendingGroupCreate(pendingStorage))

const expectedUrl = `${ORIGIN}/group/${GROUP_ID}#invite=${INVITE}`
const expectedHostUrl = `${ORIGIN}/group/${GROUP_ID}#host=${HOST}&invite=${INVITE}`
assert.equal(createGroupInvitationUrl(ORIGIN, GROUP_ID, INVITE), expectedUrl)
assert.equal(createGroupHostUrl(ORIGIN, GROUP_ID, HOST, INVITE), expectedHostUrl)
assert.deepEqual(parseGroupInvitationUrl(expectedUrl), {
  groupId: GROUP_ID,
  invitationToken: INVITE,
  cleanPath: `/group/${GROUP_ID}`,
})
assert.deepEqual(parseGroupHostUrl(expectedHostUrl), {
  groupId: GROUP_ID,
  hostToken: HOST,
  invitationToken: INVITE,
  cleanPath: `/group/${GROUP_ID}`,
})
assert.equal(classifyGroupUrlFragment(expectedUrl), 'invite')
assert.equal(classifyGroupUrlFragment(expectedHostUrl), 'host')
assert.equal(isGroupRouteUrl(expectedUrl), true)
assert.equal(new URL(expectedUrl).search, '')
assert.equal(new URL(expectedHostUrl).search, '')
assert(!expectedUrl.includes(HOST))
assert(!expectedUrl.includes('3cb_gh1_'))
assert(expectedHostUrl.includes(HOST))
assert(expectedHostUrl.includes(INVITE))
assert.notEqual(expectedUrl, expectedHostUrl)
for (const invalid of [
  `${ORIGIN}/group/${GROUP_ID}`,
  `${ORIGIN}/group/not-a-uuid#invite=${INVITE}`,
  `${ORIGIN}/group/${GROUP_ID}?invite=${INVITE}#invite=${INVITE}`,
  `${ORIGIN}/group/${GROUP_ID}#invite=bad`,
  `${ORIGIN}/group/${GROUP_ID}#invite=${INVITE}&extra=1`,
]) expectSafeError(() => parseGroupInvitationUrl(invalid))
for (const invalid of [
  expectedUrl,
  `${ORIGIN}/group/${GROUP_ID}#host=${HOST}`,
  `${ORIGIN}/group/${GROUP_ID}#host=${HOST}&invite=${INVITE}&extra=1`,
  `${ORIGIN}/group/${GROUP_ID}?host=${HOST}&invite=${INVITE}`,
  `${ORIGIN}/group/${GROUP_ID}#host=bad&invite=${INVITE}`,
]) expectSafeError(() => parseGroupHostUrl(invalid))
assert.throws(() => createGroupInvitationUrl(`${ORIGIN}/path`, GROUP_ID, INVITE), GroupInvitationUrlError)
assert.throws(() => createGroupHostUrl(`${ORIGIN}/path`, GROUP_ID, HOST, INVITE), GroupInvitationUrlError)

const storage = new MemoryStorage()
const calls: Array<{ url: string; init?: RequestInit }> = []
const client = createGroupCreateCoordinator({
  storage,
  crypto: cryptoFixture,
  origin: ORIGIN,
  fetch: async (input, init) => {
    calls.push({ url: String(input), init })
    assert(readPendingGroupCreate(storage), 'pending-create must be durable before fetch')
    return json(responseBody)
  },
})
const created = await client.run({ totalRounds: 3, playerLimit: 8 })
assert.deepEqual(created, {
  groupId: GROUP_ID,
  invitationUrl: expectedUrl,
  hostUrl: expectedHostUrl,
})
assert.notEqual(created.invitationUrl, created.hostUrl)
assert(!created.invitationUrl.includes(HOST))
assert(created.hostUrl.includes(HOST))
assert(created.hostUrl.includes(INVITE))
assert(!created.invitationUrl.includes('host_token_hash'))
assert(!created.hostUrl.includes('host_token_hash'))
assert.equal(calls.length, 1)
assert.equal(calls[0]!.url, '/api/group/matches')
assert.equal(calls[0]!.init?.method, 'POST')
assert.equal(new Headers(calls[0]!.init?.headers).get('Idempotency-Key'), REQUEST_ID)
assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
  totalRounds: 3,
  playerLimit: 8,
})
assert.equal(readPendingGroupCreate(storage), null)
assert.deepEqual(readGroupHost(storage, GROUP_ID), {
  version: 1,
  groupId: GROUP_ID,
  invitationToken: INVITE,
  hostToken: HOST,
  totalRounds: 3,
  playerLimit: 8,
  formationVersion: 1,
  ruleVersion: 1,
  scoringVersion: 1,
})
assert.deepEqual(storage.events.slice(-2), [
  `set:${groupHostStorageKey(GROUP_ID)}`,
  `remove:${GROUP_PENDING_CREATE_KEY}`,
])

const lossStorage = new MemoryStorage()
let lossCalls = 0
const requestIds: string[] = []
const lossClient = createGroupCreateCoordinator({
  storage: lossStorage,
  crypto: cryptoFixture,
  origin: ORIGIN,
  fetch: async (_input, init) => {
    lossCalls += 1
    requestIds.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
    if (lossCalls === 1) throw new Error('response lost')
    return json(responseBody, 200)
  },
})
await assert.rejects(lossClient.run({ totalRounds: 3, playerLimit: 8 }), GroupCreateClientError)
assert(readPendingGroupCreate(lossStorage))
await lossClient.run({ totalRounds: 3, playerLimit: 8 })
assert.deepEqual(requestIds, [REQUEST_ID, REQUEST_ID])

const mismatchStorage = new MemoryStorage()
savePendingGroupCreate(mismatchStorage, pending)
let mismatchFetches = 0
const mismatchClient = createGroupCreateCoordinator({
  storage: mismatchStorage,
  crypto: cryptoFixture,
  origin: ORIGIN,
  fetch: async () => {
    mismatchFetches += 1
    return json(responseBody)
  },
})
await assert.rejects(
  mismatchClient.run({ totalRounds: 4, playerLimit: 8 }),
  GroupCreateClientError,
)
assert.equal(mismatchFetches, 0)

const writeFailure = new MemoryStorage()
writeFailure.failSet = true
let writeFailureFetches = 0
const writeFailureClient = createGroupCreateCoordinator({
  storage: writeFailure,
  crypto: cryptoFixture,
  origin: ORIGIN,
  fetch: async () => {
    writeFailureFetches += 1
    return json(responseBody)
  },
})
await assert.rejects(
  writeFailureClient.run({ totalRounds: 3, playerLimit: 8 }),
  GroupCreateClientError,
)
assert.equal(writeFailureFetches, 0)

const partialStorage = new MemoryStorage()
savePendingGroupCreate(partialStorage, pending)
partialStorage.failRemove = true
expectSafeError(() => completeGroupCreate(partialStorage, {
  version: 1,
  groupId: GROUP_ID,
  invitationToken: INVITE,
  hostToken: HOST,
  totalRounds: 3,
  playerLimit: 8,
  formationVersion: 1,
  ruleVersion: 1,
  scoringVersion: 1,
}))
assert(readGroupHost(partialStorage, GROUP_ID), 'host must be durable before pending removal')
assert(readPendingGroupCreate(partialStorage), 'pending must survive failed removal')

let concurrentFetches = 0
const concurrentStorage = new MemoryStorage()
const concurrentClient = createGroupCreateCoordinator({
  storage: concurrentStorage,
  crypto: cryptoFixture,
  origin: ORIGIN,
  fetch: async () => {
    concurrentFetches += 1
    await Promise.resolve()
    return json(responseBody)
  },
})
await Promise.all([
  concurrentClient.run({ totalRounds: 3, playerLimit: 8 }),
  concurrentClient.run({ totalRounds: 3, playerLimit: 8 }),
])
assert.equal(concurrentFetches, 1)

for (const badResponse of [
  { ...responseBody, groupId: 'bad' },
  { ...responseBody, totalRounds: 4 },
  { ...responseBody, invitation: { token: 'bad' } },
  { ...responseBody, host: { token: 'bad' } },
  { ...responseBody, expiresAt: '2026-01-02T00:00:00.000Z' },
  { ...responseBody, ruleVersion: 2 },
]) {
  const badClient = createGroupCreateCoordinator({
    storage: new MemoryStorage(),
    crypto: cryptoFixture,
    origin: ORIGIN,
    fetch: async () => json(badResponse),
  })
  await assert.rejects(badClient.run({ totalRounds: 3, playerLimit: 8 }), GroupCreateClientError)
}

const vercel = JSON.parse(await readFile('vercel.json', 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>
}
assert(vercel.rewrites.some((entry) => entry.source === '/duel/:matchId'))
assert(vercel.rewrites.some((entry) => entry.source === '/group/:groupId'))
assert(
  vercel.rewrites.some(
    (entry) =>
      entry.source === '/api/duel/:path*' && entry.destination === '/api/duel',
  ),
)
assert(
  vercel.rewrites.some(
    (entry) =>
      entry.source === '/api/group/:path*' && entry.destination === '/api/group',
  ),
)
assert(
  vercel.rewrites
    .filter(
      (entry) =>
        entry.source === '/duel/:matchId' || entry.source === '/group/:groupId',
    )
    .every((entry) => entry.destination === '/index.html'),
)

const [app, mode, flow, shell, clientSource, persistenceSource, invitationSource] =
  await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/components/ModeSelect.tsx', 'utf8'),
    readFile('src/components/GroupCreateFlow.tsx', 'utf8'),
    readFile('src/components/GroupEntryShell.tsx', 'utf8'),
    readFile('src/group/groupCreateClient.ts', 'utf8'),
    readFile('src/group/groupPersistence.ts', 'utf8'),
    readFile('src/group/groupInvitation.ts', 'utf8'),
  ])
assert(mode.includes("onSelect('group')"))
assert(app.includes("setScreen('group')"))
assert(app.includes('GroupCreateFlow'))
assert(app.includes('GroupEntryShell'))
assert(!app.includes("screen === 'coming'"))
assert(flow.includes('GROUP_ROUNDS_MIN'))
assert(flow.includes('GROUP_ROUNDS_MAX'))
assert(flow.includes('GROUP_PLAYERS_MIN'))
assert(flow.includes('GROUP_PLAYERS_MAX'))
assert(shell.includes('parseGroupInvitationUrl') || shell.includes('classifyGroupUrlFragment'))
assert(shell.includes('hostUrlFromGroupHost') || shell.includes('createGroupHostUrl') || shell.includes('GroupInviteShareScreen'))
for (const source of [clientSource, persistenceSource, invitationSource]) {
  assert(!source.includes('../server/'))
  assert(!source.includes('node:crypto'))
  assert(!source.includes('console.'))
}
assert(!clientSource.includes('localStorage'))
assert(persistenceSource.includes('3cb:group:v1:'))
assert(!persistenceSource.includes('3cb:duel:v1:'))
assert(invitationSource.includes('createGroupHostUrl'))
assert(invitationSource.includes('createGroupInvitationUrl'))
assert(!invitationSource.includes('host_token_hash'))
assert(!invitationSource.includes('hostTokenHash'))

console.log('verify:group-browser-create OK')
