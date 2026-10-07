import assert from 'node:assert/strict'
import {
  aggregateGroupParticipantResult,
  canAutomaticallyFinalizeGroup,
  compareGroupParticipantScores,
  createGroupNicknameKey,
  GroupDomainValidationError,
  judgeGroupBag,
  rankGroupParticipants,
  validateGroupNickname,
  validateGroupPlacementSet,
  validateGroupPlayers,
  validateGroupRounds,
  type GroupParticipantResultInput,
  type GroupParticipantResultSummary,
  type GroupRoundPlacement,
  type GroupRoundResultInput,
} from '../src/group/groupDomain'

const accepted = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`
const placement = (
  roundNumber: number,
  coinBagNumbers: readonly [number, number, number] = [1, 2, 3],
  bombBagNumber = 4,
): GroupRoundPlacement => ({
  roundNumber,
  bagCount: 4,
  bombBagNumber,
  coinBagNumbers,
})
const opens = (...bags: number[]) =>
  bags.map((bagNumber, index) => ({ openOrder: index + 1, bagNumber }))
const round = (
  roundNumber: number,
  endReason: GroupRoundResultInput['endReason'],
  capturedCoins: number,
  bags: readonly number[],
): GroupRoundResultInput => ({
  roundNumber,
  endReason,
  capturedCoins,
  opens: opens(...bags),
})
const aggregate = (
  participantId: string,
  placements: readonly GroupRoundPlacement[],
  rounds: readonly GroupRoundResultInput[],
  acceptedAt = accepted(0),
) => aggregateGroupParticipantResult({
  participantId,
  acceptedAt,
  totalRounds: rounds.length,
  placements,
  rounds,
})

assert.equal(validateGroupRounds(1), 1)
assert.equal(validateGroupRounds(20), 20)
assert.throws(() => validateGroupRounds(0), GroupDomainValidationError)
assert.throws(() => validateGroupRounds(21), GroupDomainValidationError)
assert.equal(validateGroupPlayers(2), 2)
assert.equal(validateGroupPlayers(20), 20)
assert.throws(() => validateGroupPlayers(1), GroupDomainValidationError)
assert.throws(() => validateGroupPlayers(21), GroupDomainValidationError)
assert.equal(canAutomaticallyFinalizeGroup(8, 8, 8), true)
assert.equal(canAutomaticallyFinalizeGroup(5, 5, 8), false)
assert.equal(canAutomaticallyFinalizeGroup(8, 7, 8), false)
assert.throws(
  () => canAutomaticallyFinalizeGroup(5, 6, 8),
  GroupDomainValidationError,
)

for (const nickname of [
  'Alice', 'ALICE', 'alice123', '桃太郎', 'ももたろう', 'モモタロウ',
  '桃太郎3', 'Élodie', 'محمد', 'สมชาย', 'हिन्दी', '한국어',
]) {
  assert.equal(validateGroupNickname(nickname), nickname)
}
for (const nickname of [
  '', '桃 太郎', '桃太郎!', '🍑太郎', 'Ａｌｉｃｅ１２３', 'Alice_1',
  'a'.repeat(21), '\u0301', 'a\nb',
]) {
  assert.throws(() => validateGroupNickname(nickname), GroupDomainValidationError)
}
assert.throws(
  () => validateGroupNickname('👍🏽'.repeat(20)),
  GroupDomainValidationError,
)
assert.equal(validateGroupNickname('か\u3099'), 'か\u3099', 'combined grapheme display is preserved')
assert.equal(createGroupNicknameKey('か\u3099'), createGroupNicknameKey('が'))
assert.notEqual(createGroupNicknameKey('Alice'), createGroupNicknameKey('alice'))
assert.equal(validateGroupNickname('𠮷'.repeat(20)), '𠮷'.repeat(20))
assert.throws(() => validateGroupNickname('𠮷'.repeat(21)), GroupDomainValidationError)

const sources = validateGroupPlacementSet({
  totalRounds: 2,
  placements: [
    { origin: 'generated', placement: placement(1, [1, 1, 2]) },
    { origin: 'duel-history', placement: placement(2, [1, 2, 3]) },
  ],
})
assert.deepEqual(sources.placements.map((item) => item.origin), [
  'generated', 'duel-history',
])
assert.throws(() => validateGroupPlacementSet({
  totalRounds: 2,
  placements: [{ origin: 'generated', placement: placement(1) }],
}), GroupDomainValidationError)
assert.throws(() => validateGroupPlacementSet({
  totalRounds: 1,
  placements: [{
    origin: 'generated',
    placement: { ...placement(1), unexpected: true },
  }],
}), GroupDomainValidationError)
assert.throws(() => validateGroupPlacementSet({
  totalRounds: 1,
  placements: [{ origin: 'generated', placement: placement(1, [1, 2, 4]) }],
}), GroupDomainValidationError)
assert.deepEqual(judgeGroupBag(placement(1, [1, 1, 1]), 1), {
  outcome: 'coins', coinsFound: 3,
})
assert.deepEqual(judgeGroupBag(placement(1, [1, 1, 2]), 2), {
  outcome: 'coins', coinsFound: 1,
})
assert.deepEqual(judgeGroupBag(placement(1), 4), {
  outcome: 'bomb', coinsFound: 0,
})
assert.deepEqual(judgeGroupBag(placement(1), 1), {
  outcome: 'coins', coinsFound: 1,
})
assert.throws(() => judgeGroupBag(placement(1), 5), GroupDomainValidationError)

const mixed = aggregate(
  'mixed',
  [
    placement(1, [1, 1, 1]),
    placement(2, [1, 1, 2]),
    placement(3, [1, 2, 3]),
    placement(4, [1, 2, 3]),
  ],
  [
    round(1, 'cleared', 3, [1]),
    round(2, 'cashed_out', 2, [3, 1]),
    round(3, 'bombed', 0, [1, 4]),
    round(4, 'interrupted', 0, [2, 3]),
  ],
)
assert.equal(mixed.totalCapturedCoins, 5)
assert.equal(mixed.threeCoinsComplete, 1)
assert.equal(mixed.coinBagHits, 5, '1/2/3 coin contents count as one hit per opened bag')
assert.equal(mixed.totalOpens, 7, 'EMPTY/BOMB/interrupted opens remain in denominator')
assert.deepEqual(mixed.rounds[3], {
  roundNumber: 4,
  endReason: 'interrupted',
  capturedCoins: 0,
  openedBagCount: 2,
  coinBagHits: 2,
})

const interruptedZero = aggregate(
  'zero',
  [placement(1)],
  [round(1, 'interrupted', 0, [])],
)
assert.equal(interruptedZero.totalCapturedCoins, 0)
assert.equal(interruptedZero.threeCoinsComplete, 0)
assert.equal(interruptedZero.coinBagHits, 0)
assert.equal(interruptedZero.totalOpens, 0)
assert.deepEqual(interruptedZero.hitRate, { numerator: 0, denominator: 0 })
assert.throws(() => aggregate(
  'bad-interrupt',
  [placement(1)],
  [round(1, 'interrupted', 0, [4])],
), GroupDomainValidationError)
assert.throws(() => aggregate(
  'bad-interrupt-clear',
  [placement(1)],
  [round(1, 'interrupted', 0, [1, 2, 3])],
), GroupDomainValidationError)

function summary(
  participantId: string,
  coins: number,
  completes: number,
  hits: number,
  totalOpens: number,
  acceptedAt = accepted(0),
): GroupParticipantResultSummary {
  return {
    participantId,
    acceptedAt,
    totalCapturedCoins: coins,
    threeCoinsComplete: completes,
    coinBagHits: hits,
    totalOpens,
    hitRate: { numerator: hits, denominator: totalOpens },
    rounds: Array.from({ length: Math.max(completes, 1) }, (_, index) => ({
      roundNumber: index + 1,
      endReason: index < completes ? 'cleared' as const : 'interrupted' as const,
      capturedCoins: index < completes ? 3 as const : 0 as const,
      openedBagCount: 0,
      coinBagHits: 0,
    })),
  }
}

assert(compareGroupParticipantScores(
  summary('coins', 6, 0, 0, 1),
  summary('completes', 5, 20, 1, 1),
) < 0, 'TOTAL COINS is first')
assert(compareGroupParticipantScores(
  summary('completes', 6, 2, 0, 1),
  summary('rate', 6, 1, 1, 1),
) < 0, '3COINS COMPLETE is second')
assert(compareGroupParticipantScores(
  summary('two-thirds', 6, 1, 2, 3),
  summary('four-sixths', 6, 1, 4, 6),
) === 0, 'equal rates use exact integer cross-products')
assert(compareGroupParticipantScores(
  summary('positive', 6, 1, 1, 3),
  summary('no-opens', 6, 1, 0, 0),
) < 0)
assert(compareGroupParticipantScores(
  summary('zero-with-opens', 6, 1, 0, 3),
  summary('no-opens', 6, 1, 0, 0),
) === 0, 'no opens is a zero rate')

const ranked = rankGroupParticipants([
  summary('late-tie-a', 10, 1, 1, 2, accepted(4)),
  summary('rank-six', 6, 0, 0, 1, accepted(5)),
  summary('early-tie-a', 10, 1, 2, 4, accepted(1)),
  summary('rank-three', 9, 2, 1, 2, accepted(2)),
  summary('late-tie-b', 8, 0, 0, 1, accepted(4)),
  summary('early-tie-b', 8, 0, 0, 0, accepted(3)),
])
assert.deepEqual(ranked.map(({ participantId, rank }) => ({ participantId, rank })), [
  { participantId: 'early-tie-a', rank: 1 },
  { participantId: 'late-tie-a', rank: 1 },
  { participantId: 'rank-three', rank: 3 },
  { participantId: 'early-tie-b', rank: 4 },
  { participantId: 'late-tie-b', rank: 4 },
  { participantId: 'rank-six', rank: 6 },
])
assert.equal(
  compareGroupParticipantScores(
    summary('early', 3, 1, 1, 2, accepted(1)),
    summary('late', 3, 1, 1, 2, accepted(9)),
  ),
  0,
  'accepted_at must not affect score equality',
)

const _typeCheck: GroupParticipantResultInput = {
  participantId: 'participant',
  acceptedAt: accepted(0),
  totalRounds: 1,
  placements: [placement(1)],
  rounds: [round(1, 'interrupted', 0, [])],
}
assert.equal(_typeCheck.totalRounds, 1)

console.log('verify:group-domain OK')
