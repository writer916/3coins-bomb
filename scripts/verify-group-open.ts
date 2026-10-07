/** GROUP atomic OPEN API, client retry, local prediction, and UI wiring checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGroupOpenHandler } from '../api/group/matches/[groupId]/open.ts'
import { validateGroupOpenRequest, openGroupBag, GroupOpenError } from '../server/group/openBag.ts'
import { createGroupPlayBootstrapCoordinator, createGroupPlayClient, parseGroupOpenResult } from '../src/group/groupPlayClient.ts'
import { groupParticipantStorageKey } from '../src/group/groupPersistence.ts'
import { judgeGroupBag } from '../src/group/groupDomain.ts'

const root = resolve(import.meta.dirname, '..')
const groupId = '123e4567-e89b-42d3-a456-426614174000'
const participantId = '323e4567-e89b-42d3-a456-426614174000'
const requestId = '423e4567-e89b-42d3-a456-426614174000'
const token = '3cb_gp1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const auth = `Bearer ${token}`
const request = validateGroupOpenRequest(groupId, auth, requestId, { bagNumber: 2 })
assert.equal(request.bagNumber, 2)
assert.throws(() => validateGroupOpenRequest(groupId, auth, requestId, { bagNumber: 2, outcome: 'bomb' }), GroupOpenError)
assert.throws(() => validateGroupOpenRequest(groupId, null, requestId, { bagNumber: 2 }), GroupOpenError)

const view = { groupId, roundNumber: 1, bagNumber: 2, openOrder: 1, outcome: 'coins' as const, coinsFound: 2 as const, provisionalCoins: 2 as const, openedBagCount: 1, roundEnded: false, endReason: null, capturedCoins: 0 as const }
assert.deepEqual(await openGroupBag(request, async () => ({ status: 'opened', view })), view)
await assert.rejects(() => openGroupBag(request, async () => ({ status: 'conflict' })), GroupOpenError)
const response = await createGroupOpenHandler(async () => view)(new Request(`https://example.test/api/group/matches/${groupId}/open`, { method: 'POST', headers: { Authorization: auth, 'Idempotency-Key': requestId, 'Content-Type': 'application/json' }, body: JSON.stringify({ bagNumber: 2 }) }))
assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(await response.json(), view)

const placement = { roundNumber: 1, bagCount: 5, bombBagNumber: 5, coinBagNumbers: [1, 2, 2] as [number, number, number] }
assert.deepEqual(judgeGroupBag(placement, 3), { outcome: 'empty', coinsFound: 0 })
assert.deepEqual(judgeGroupBag(placement, 5), { outcome: 'bomb', coinsFound: 0 })
assert.deepEqual(judgeGroupBag(placement, 1), { outcome: 'coins', coinsFound: 1 })
assert.deepEqual(judgeGroupBag(placement, 2), { outcome: 'coins', coinsFound: 2 })
assert.deepEqual(judgeGroupBag({ ...placement, coinBagNumbers: [2, 2, 2] }, 2), { outcome: 'coins', coinsFound: 3 })
assert.deepEqual(parseGroupOpenResult(view, { groupId, bagNumber: 2, requestId }), view)

const storage = { values: new Map<string, string>(), getItem(key: string) { return this.values.get(key) ?? null }, setItem(key: string, value: string) { this.values.set(key, value) }, removeItem(key: string) { this.values.delete(key) } }
storage.setItem(groupParticipantStorageKey(groupId), JSON.stringify({ version: 1, groupId, participantId, displayNickname: 'Player', token, acceptedAt: '2026-10-07T00:00:00.000Z' }))
let attempts = 0; const ids: string[] = []
const client = createGroupPlayClient({ storage, crypto: { randomUUID: () => requestId as `${string}-${string}-${string}-${string}-${string}` }, fetch: async (_input, init) => {
  attempts += 1; ids.push((init!.headers as Record<string,string>)['Idempotency-Key']); return attempts === 1 ? new Response('', { status: 503 }) : Response.json(view)
} })
const coordinator = createGroupPlayBootstrapCoordinator(client)
await assert.rejects(() => coordinator.open(groupId, 2))
assert.deepEqual(await coordinator.open(groupId, 2), view)
assert.deepEqual(ids, [requestId, requestId])

const db = readFileSync(resolve(root, 'server/db/openGroupBag.ts'), 'utf8')
for (const fragment of ['with candidate as materialized', 'for update', 'insert into group_round_opens', 'on conflict do nothing', "status = 'active'", 'terminal_request_id', 'unnest(target.coin_bag_numbers)']) assert.ok(db.includes(fragment), fragment)
const ui = readFileSync(resolve(root, 'src/components/GroupPlayScreen.tsx'), 'utf8')
for (const fragment of ['getLocalOpenResult', 'createOptimisticOpenGate', 'CoinOpenFx', 'EmptyOpenFx', 'BombOpenFx', 'visualHiddenBagIds', 'startNext']) assert.ok(ui.includes(fragment), fragment)
for (const forbidden of ['RevealBoard', 'localStorage', 'sessionStorage']) assert.equal(ui.includes(forbidden), false)
console.log('verify:group-open OK')
