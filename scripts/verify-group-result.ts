import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGetGroupResultHandler } from '../api/_group/matches/[groupId]/result'
import {
  aggregateGroupParticipantResult,
  compareGroupParticipantScores,
  rankGroupParticipants,
  type GroupParticipantResultSummary,
  type GroupRoundPlacement,
} from '../src/group/groupDomain'
import { GetGroupResultError, getGroupResult, validateGetGroupResultRequest } from '../server/group/getResult'
import { deriveGroupParticipantCapability } from '../server/auth/groupTokens'

const root = resolve(import.meta.dirname, '..')
const env = { DUEL_TOKEN_HMAC_KEY: 'A'.repeat(43) }
const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const token = deriveGroupParticipantCapability(GROUP_ID, 'Alice', env)
const accepted = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`
const placement = (roundNumber: number, coins: readonly [number, number, number] = [1, 2, 3]): GroupRoundPlacement => ({ roundNumber, bagCount: 4, bombBagNumber: 4, coinBagNumbers: coins })
const aggregate = (id: string, endReason: 'bombed'|'cashed_out'|'cleared'|'interrupted', capturedCoins: number, bags: number[], coins: readonly [number,number,number] = [1,2,3], acceptedAt=accepted(0)) => aggregateGroupParticipantResult({
  participantId:id, acceptedAt, totalRounds:1, placements:[placement(1,coins)],
  rounds:[{roundNumber:1,endReason,capturedCoins,opens:bags.map((bagNumber,index)=>({openOrder:index+1,bagNumber}))}],
})

assert.equal(aggregate('bomb', 'bombed', 2, [1,2,4]).totalCapturedCoins, 2)
assert.equal(aggregate('cash', 'cashed_out', 2, [1,2]).totalCapturedCoins, 2)
assert.equal(aggregate('interrupt', 'interrupted', 0, [1]).totalCapturedCoins, 0)
assert.equal(aggregate('one-two', 'cleared', 3, [1,2], [1,2,2]).threeCoinsComplete, 1)
assert.equal(aggregate('ones', 'cleared', 3, [1,2,3]).threeCoinsComplete, 1)
assert.equal(aggregate('three', 'cleared', 3, [1], [1,1,1]).threeCoinsComplete, 1)
for (const reason of ['cashed_out','bombed','interrupted'] as const) {
  const bags = reason === 'bombed' ? [1,4] : [1]
  const captured = reason === 'interrupted' ? 0 : 1
  assert.equal(aggregate(reason, reason, captured, bags).threeCoinsComplete, 0)
}
assert.deepEqual(aggregate('hits', 'bombed', 2, [1,2,4]).hitRate, { numerator:2, denominator:3 })
assert.deepEqual(aggregate('multi', 'cleared', 3, [1], [1,1,1]).hitRate, { numerator:1, denominator:1 })
assert.deepEqual(aggregate('empty-bomb', 'bombed', 0, [2,4], [1,1,1]).hitRate, { numerator:0, denominator:2 })
assert.deepEqual(aggregate('zero', 'interrupted', 0, []).hitRate, { numerator:0, denominator:0 })

function summary(id:string,coins:number,completes:number,hits:number,opens:number,at=accepted(0)):GroupParticipantResultSummary{return{participantId:id,acceptedAt:at,totalCapturedCoins:coins,threeCoinsComplete:completes,coinBagHits:hits,totalOpens:opens,hitRate:{numerator:hits,denominator:opens},rounds:Array.from({length:Math.max(1,completes)},(_,i)=>({roundNumber:i+1,endReason:i<completes?'cleared':'interrupted',capturedCoins:i<completes?3:0,openedBagCount:0,coinBagHits:0}))}}
assert(compareGroupParticipantScores(summary('coins',9,0,0,1),summary('complete',8,2,1,1))<0)
assert(compareGroupParticipantScores(summary('complete',9,2,0,1),summary('rate',9,1,1,1))<0)
assert(compareGroupParticipantScores(summary('rate',9,1,2,3),summary('lower',9,1,3,5))<0)
assert.equal(compareGroupParticipantScores(summary('a',9,1,2,3),summary('b',9,1,4,6)),0)
const ranked=rankGroupParticipants([
 summary('late-a',10,1,1,2,accepted(4)),summary('six',6,0,0,1,accepted(5)),summary('early-a',10,1,2,4,accepted(1)),summary('three',9,2,1,2,accepted(2)),summary('late-b',8,0,0,1,accepted(4)),summary('early-b',8,0,0,0,accepted(3)),
])
assert.deepEqual(ranked.map(x=>[x.participantId,x.rank]),[['early-a',1],['late-a',1],['three',3],['early-b',4],['late-b',4],['six',6]])

const request=validateGetGroupResultRequest(GROUP_ID,`Bearer ${token}`)
assert.equal(request.groupId,GROUP_ID)
for(const authorization of [null,'Bearer invalid','Bearer 3cb_gh1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','Bearer 3cb_gi1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) assert.throws(()=>validateGetGroupResultRequest(GROUP_ID,authorization),GetGroupResultError)
const view={groupId:GROUP_ID,totalRounds:1,playerLimit:2,acceptedCount:2,completedCount:1,status:'closed' as const,ranking:[{rank:1,entryKey:'ABCDEFGHIJKLMNOPQRSTUV',nickname:'Alice',isSelf:true,totalCoins:3,threeCoinsComplete:1,coinBagHits:1,totalOpens:1,coinBagHitRate:{numerator:1,denominator:1}}]}
assert.deepEqual(await getGroupResult(request,async(id,hash)=>{assert.equal(id,GROUP_ID);assert.match(hash,/^[0-9a-f]{64}$/);return{kind:'closed',view}}),view)
await assert.rejects(()=>getGroupResult(request,async()=>({kind:'open'})),GetGroupResultError)
await assert.rejects(()=>getGroupResult(request,async()=>null),GetGroupResultError)

const handler=createGetGroupResultHandler(async()=>view)
const response=await handler(new Request(`https://example.test/api/group/matches/${GROUP_ID}/result`,{headers:{authorization:`Bearer ${token}`}}))
assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),view)
const unavailable=createGetGroupResultHandler(async()=>{throw new GetGroupResultError()})
assert.equal((await unavailable(new Request(`https://example.test/api/group/matches/${GROUP_ID}/result`,{headers:{authorization:`Bearer ${token}`}}))).status,404)
assert.equal((await handler(new Request(`https://example.test/api/group/matches/${GROUP_ID}/result`,{method:'POST'}))).status,405)

const db=readFileSync(resolve(root,'server/db/getGroupResult.ts'),'utf8')
for(const fragment of ["candidate.status = 'closed'","participant.completed_at is not null","participant.excluded_at is null",'group_round_placements','group_round_attempts','group_round_opens','openedBagCount','rankGroupParticipants','aggregateGroupParticipantResult','createGroupResultEntryKey','entryKey']) assert.ok(db.includes(fragment),fragment)
assert.match(db,/participant\.accepted_at, participant\.id/)
assert.doesNotMatch(JSON.stringify(view),/token|hash|participantId|acceptedAt|placement/i)
assert.doesNotMatch(readFileSync(resolve(root,'api/_group/matches/[groupId]/result.ts'),'utf8'),/hostToken|invitationToken|displayNickname/)
assert.notEqual(GROUP_ID,OTHER_ID)
console.log('verify:group-result OK')
