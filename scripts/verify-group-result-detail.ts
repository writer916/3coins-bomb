/** GROUP RESULT participant detail API / domain / auth / boundary checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetGroupResultDetailHandler } from '../api/_group/matches/[groupId]/result/[entryKey].ts'
import {
  deriveGroupCreationCapabilities,
  deriveGroupParticipantCapability,
  GROUP_HOST_TOKEN_PREFIX,
  GROUP_INVITATION_TOKEN_PREFIX,
} from '../server/auth/groupTokens.ts'
import {
  createGroupResultEntryKey,
  validateGroupResultEntryKey,
} from '../server/group/resultEntryKey.ts'
import {
  GetGroupResultDetailError,
  getGroupResultDetail,
  validateGetGroupResultDetailRequest,
} from '../server/group/getResultDetail.ts'
import {
  aggregateGroupParticipantResult,
  type GroupRoundPlacement,
} from '../src/group/groupDomain.ts'
import { revealGroupRoundOpens } from '../src/group/groupResultDetail.ts'

const root = resolve(import.meta.dirname, '..')
const env = { DUEL_TOKEN_HMAC_KEY: 'A'.repeat(43) }
const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_GROUP = '22222222-2222-4222-8222-222222222222'
const PARTICIPANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARTICIPANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tokenA = deriveGroupParticipantCapability(GROUP_ID, 'Alice', env)
const tokenB = deriveGroupParticipantCapability(GROUP_ID, 'Bob', env)
const otherToken = deriveGroupParticipantCapability(OTHER_GROUP, 'Alice', env)
const invite = deriveGroupCreationCapabilities(GROUP_ID, env).invitationToken
const host = deriveGroupCreationCapabilities(GROUP_ID, env).hostToken
const entryA = createGroupResultEntryKey(GROUP_ID, PARTICIPANT_A)
const entryB = createGroupResultEntryKey(GROUP_ID, PARTICIPANT_B)

assert.equal(entryA.length, 22)
assert.notEqual(entryA, entryB)
assert.equal(createGroupResultEntryKey(GROUP_ID, PARTICIPANT_A), entryA)
assert.equal(validateGroupResultEntryKey(entryA), entryA)
assert.throws(() => validateGroupResultEntryKey(PARTICIPANT_A))
assert.throws(() => validateGroupResultEntryKey('short'))
assert.throws(() => validateGroupResultEntryKey(`${entryA}!`))

const placement = (
  roundNumber: number,
  coins: readonly [number, number, number] = [1, 2, 3],
): GroupRoundPlacement => ({
  roundNumber,
  bagCount: 4,
  bombBagNumber: 4,
  coinBagNumbers: coins,
})

const opens = revealGroupRoundOpens(placement(1, [1, 1, 2]), [
  { openOrder: 1, bagNumber: 3 },
  { openOrder: 2, bagNumber: 1 },
  { openOrder: 3, bagNumber: 2 },
])
assert.deepEqual(opens, [
  { order: 1, bagNumber: 3, kind: 'empty', coinCount: 0 },
  { order: 2, bagNumber: 1, kind: 'coins', coinCount: 2 },
  { order: 3, bagNumber: 2, kind: 'coins', coinCount: 1 },
])
assert.deepEqual(revealGroupRoundOpens(placement(1), [{ openOrder: 1, bagNumber: 4 }]), [
  { order: 1, bagNumber: 4, kind: 'bomb', coinCount: 0 },
])
assert.deepEqual(
  revealGroupRoundOpens(placement(1, [2, 2, 2]), [{ openOrder: 1, bagNumber: 2 }]),
  [{ order: 1, bagNumber: 2, kind: 'coins', coinCount: 3 }],
)

const bombSummary = aggregateGroupParticipantResult({
  participantId: PARTICIPANT_A,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  totalRounds: 1,
  placements: [placement(1)],
  rounds: [
    {
      roundNumber: 1,
      endReason: 'bombed',
      capturedCoins: 0,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 2 },
        { openOrder: 3, bagNumber: 4 },
      ],
    },
  ],
})
assert.equal(bombSummary.totalCapturedCoins, 0)
assert.equal(bombSummary.rounds[0]?.capturedCoins, 0)
assert.equal(bombSummary.rounds[0]?.openedBagCount, 3)
assert.deepEqual(bombSummary.hitRate, { numerator: 2, denominator: 3 })
assert.throws(() =>
  aggregateGroupParticipantResult({
    participantId: PARTICIPANT_A,
    acceptedAt: '2026-01-01T00:00:00.000Z',
    totalRounds: 1,
    placements: [placement(1)],
    rounds: [
      {
        roundNumber: 1,
        endReason: 'bombed',
        capturedCoins: 2,
        opens: [
          { openOrder: 1, bagNumber: 1 },
          { openOrder: 2, bagNumber: 2 },
          { openOrder: 3, bagNumber: 4 },
        ],
      },
    ],
  }),
)

const interrupted = aggregateGroupParticipantResult({
  participantId: PARTICIPANT_A,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  totalRounds: 1,
  placements: [placement(1)],
  rounds: [
    {
      roundNumber: 1,
      endReason: 'interrupted',
      capturedCoins: 0,
      opens: [
        { openOrder: 1, bagNumber: 1 },
        { openOrder: 2, bagNumber: 3 },
      ],
    },
  ],
})
assert.equal(interrupted.totalCapturedCoins, 0)
assert.equal(interrupted.rounds[0]?.openedBagCount, 2)

const detailView = {
  groupId: GROUP_ID,
  entryKey: entryA,
  nickname: 'Alice',
  isSelf: true,
  totalCoins: 5,
  threeCoinsComplete: 1,
  coinBagHits: 3,
  totalOpens: 5,
  coinBagHitRate: { numerator: 3, denominator: 5 },
  rounds: [
    {
      roundNumber: 1,
      endReason: 'cleared' as const,
      capturedCoins: 3 as const,
      openedBagCount: 2,
      bagCount: 4,
      bombBagNumber: 4,
      coinBagNumbers: [1, 2, 3] as const,
      opens: [
        { order: 1, bagNumber: 1, kind: 'coins' as const, coinCount: 1 as const },
        { order: 2, bagNumber: 2, kind: 'coins' as const, coinCount: 2 as const },
      ],
    },
    {
      roundNumber: 2,
      endReason: 'cashed_out' as const,
      capturedCoins: 2 as const,
      openedBagCount: 2,
      bagCount: 4,
      bombBagNumber: 4,
      coinBagNumbers: [1, 1, 2] as const,
      opens: [
        { order: 1, bagNumber: 3, kind: 'empty' as const, coinCount: 0 as const },
        { order: 2, bagNumber: 1, kind: 'coins' as const, coinCount: 2 as const },
      ],
    },
    {
      roundNumber: 3,
      endReason: 'bombed' as const,
      capturedCoins: 0 as const,
      openedBagCount: 1,
      bagCount: 4,
      bombBagNumber: 4,
      coinBagNumbers: [1, 2, 3] as const,
      opens: [
        { order: 1, bagNumber: 4, kind: 'bomb' as const, coinCount: 0 as const },
      ],
    },
    {
      roundNumber: 4,
      endReason: 'interrupted' as const,
      capturedCoins: 0 as const,
      openedBagCount: 1,
      bagCount: 4,
      bombBagNumber: 4,
      coinBagNumbers: [1, 2, 3] as const,
      opens: [
        { order: 1, bagNumber: 3, kind: 'empty' as const, coinCount: 0 as const },
      ],
    },
  ],
}

const validated = validateGetGroupResultDetailRequest(
  GROUP_ID,
  entryA,
  `Bearer ${tokenA}`,
)
assert.equal(validated.entryKey, entryA)
for (const authorization of [
  null,
  'Bearer invalid',
  `Bearer ${invite}`,
  `Bearer ${host}`,
  `Bearer ${GROUP_INVITATION_TOKEN_PREFIX}${'A'.repeat(43)}`,
  `Bearer ${GROUP_HOST_TOKEN_PREFIX}${'A'.repeat(43)}`,
]) {
  assert.throws(
    () => validateGetGroupResultDetailRequest(GROUP_ID, entryA, authorization),
    GetGroupResultDetailError,
  )
}
// Foreign GROUP participant tokens pass capability shape checks but resolve to null.
await assert.rejects(
  () =>
    getGroupResultDetail(
      validateGetGroupResultDetailRequest(GROUP_ID, entryA, `Bearer ${otherToken}`),
      async () => null,
    ),
  GetGroupResultDetailError,
)
assert.throws(
  () => validateGetGroupResultDetailRequest(GROUP_ID, PARTICIPANT_A, `Bearer ${tokenA}`),
  GetGroupResultDetailError,
)

assert.deepEqual(
  await getGroupResultDetail(validated, async (id, hash, key) => {
    assert.equal(id, GROUP_ID)
    assert.match(hash, /^[0-9a-f]{64}$/)
    assert.equal(key, entryA)
    return { kind: 'closed', view: detailView }
  }),
  detailView,
)
await assert.rejects(
  () => getGroupResultDetail(validated, async () => ({ kind: 'open' })),
  GetGroupResultDetailError,
)
await assert.rejects(
  () => getGroupResultDetail(validated, async () => ({ kind: 'missing' })),
  GetGroupResultDetailError,
)
await assert.rejects(
  () => getGroupResultDetail(validated, async () => null),
  GetGroupResultDetailError,
)

const handler = createGetGroupResultDetailHandler(async () => detailView)
const ok = await handler(
  new Request(
    `https://example.test/api/group/matches/${GROUP_ID}/result/${entryA}`,
    { headers: { authorization: `Bearer ${tokenA}` } },
  ),
)
assert.equal(ok.status, 200)
assert.equal(ok.headers.get('cache-control'), 'no-store')
assert.deepEqual(await ok.json(), detailView)
assert.doesNotMatch(JSON.stringify(detailView), /token|hash|participantId|acceptedAt/i)
assert.match(JSON.stringify(detailView), /"bagCount"/)
assert.match(JSON.stringify(detailView), /"bombBagNumber"/)
assert.match(JSON.stringify(detailView), /"coinBagNumbers"/)
assert.match(JSON.stringify(detailView), /"bagNumber"/)
assert.doesNotMatch(JSON.stringify(detailView), /"placement"/)

const unavailable = createGetGroupResultDetailHandler(async () => {
  throw new GetGroupResultDetailError()
})
assert.equal(
  (
    await unavailable(
      new Request(
        `https://example.test/api/group/matches/${GROUP_ID}/result/${entryA}`,
        { headers: { authorization: `Bearer ${tokenA}` } },
      ),
    )
  ).status,
  404,
)
assert.equal(
  (
    await handler(
      new Request(
        `https://example.test/api/group/matches/${GROUP_ID}/result/${entryA}`,
        { method: 'POST', headers: { authorization: `Bearer ${tokenA}` } },
      ),
    )
  ).status,
  405,
)

const db = readFileSync(resolve(root, 'server/db/getGroupResult.ts'), 'utf8')
for (const fragment of [
  'getGroupResultDetailForParticipant',
  'createGroupResultEntryKey',
  'revealGroupRoundOpens',
  'bagCount: placement.bagCount',
  'bombBagNumber: placement.bombBagNumber',
  'coinBagNumbers: placement.coinBagNumbers',
  "participant.completed_at is not null",
  "participant.excluded_at is null",
  "candidate.status = 'closed'",
  'kind: \'missing\'',
  "kind: 'open'",
]) {
  assert.ok(db.includes(fragment), fragment)
}
assert.match(db, /if \(row\.status === 'open'\) return \{ kind: 'open' \}/)
assert.doesNotMatch(
  readFileSync(resolve(root, 'api/_group/matches/[groupId]/result/[entryKey].ts'), 'utf8'),
  /hostToken|invitationToken|displayNickname/,
)
assert.notEqual(tokenA, tokenB)
console.log('verify:group-result-detail OK')
