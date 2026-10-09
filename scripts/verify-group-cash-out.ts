/** GROUP CASH OUT API, retry, authoritative SQL, client, and UI checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGroupCashOutHandler } from '../api/_group/matches/[groupId]/cash-out.ts'
import { cashOutGroupRound, GroupCashOutError, validateGroupCashOutRequest } from '../server/group/cashOutRound.ts'
import { createGroupPlayBootstrapCoordinator, createGroupPlayClient, parseGroupCashOutResult } from '../src/group/groupPlayClient.ts'
import { groupParticipantStorageKey } from '../src/group/groupPersistence.ts'
const root=resolve(import.meta.dirname,'..'), groupId='123e4567-e89b-42d3-a456-426614174000', participantId='323e4567-e89b-42d3-a456-426614174000', requestId='423e4567-e89b-42d3-a456-426614174000'
const token='3cb_gp1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', auth=`Bearer ${token}`
const request=validateGroupCashOutRequest(groupId,auth,requestId); assert.equal(request.groupId,groupId)
assert.throws(()=>validateGroupCashOutRequest(groupId,null,requestId),GroupCashOutError)
const view={groupId,roundNumber:1,endReason:'cashed_out' as const,capturedCoins:2 as const,openedBagCount:3,participantCompleted:false}
assert.deepEqual(await cashOutGroupRound(request,async()=>({status:'cashed_out',view})),view)
assert.deepEqual(await cashOutGroupRound(request,async()=>({status:'retry',view})),view)
await assert.rejects(()=>cashOutGroupRound(request,async()=>({status:'conflict'})),GroupCashOutError)
const response=await createGroupCashOutHandler(async()=>view)(new Request(`https://example.test/api/group/matches/${groupId}/cash-out`,{method:'POST',headers:{Authorization:auth,'Idempotency-Key':requestId}})); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store'); assert.deepEqual(await response.json(),view)
assert.equal((await createGroupCashOutHandler(async()=>view)(new Request(`https://example.test/api/group/matches/${groupId}/cash-out`,{method:'POST',headers:{Authorization:auth,'Idempotency-Key':requestId},body:'{"capturedCoins":3}'}))).status,400)
assert.deepEqual(parseGroupCashOutResult(view,{groupId,requestId}),view)

const storage={values:new Map<string,string>(),getItem(k:string){return this.values.get(k)??null},setItem(k:string,v:string){this.values.set(k,v)},removeItem(k:string){this.values.delete(k)}}
storage.setItem(groupParticipantStorageKey(groupId),JSON.stringify({version:1,groupId,participantId,displayNickname:'Player',token,acceptedAt:'2026-10-07T00:00:00.000Z'}))
let attempts=0; const ids:string[]=[]
const client=createGroupPlayClient({storage,crypto:{randomUUID:()=>requestId as `${string}-${string}-${string}-${string}-${string}`},fetch:async(input,init)=>{assert.equal(String(input),`/api/group/matches/${groupId}/cash-out`); assert.equal(init?.method,'POST'); const h=init!.headers as Record<string,string>; assert.equal(h.Authorization,auth); ids.push(h['Idempotency-Key']); attempts++; return attempts===1?new Response('',{status:503}):Response.json(view)}})
const coordinator=createGroupPlayBootstrapCoordinator(client); await assert.rejects(()=>coordinator.cashOut(groupId)); assert.deepEqual(await coordinator.cashOut(groupId),view); assert.deepEqual(ids,[requestId,requestId])

const db=readFileSync(resolve(root,'server/db/cashOutGroupRound.ts'),'utf8')
for(const fragment of ['for update of match, participant',"attempt.status = 'active'",'unnest(target.coin_bag_numbers)','summary.provisional_coins in (1, 2)',"status = 'cashed_out'",'terminal_request_id','completed_at = statement_timestamp()']) assert.ok(db.includes(fragment),fragment)
assert.match(db,/input: \{ groupId: string; participantTokenHash: string; requestId: string \}/)
const ui=readFileSync(resolve(root,'src/components/GroupPlayScreen.tsx'),'utf8')
assert.match(ui,/canShowGroupCashOutButton/)
assert.match(ui,/isGroupCashOutButtonDisabled/)
assert.match(ui,/disabled=\{cashOutDisabled\}/)
assert.match(ui,/getPendingOpen/)
assert.match(ui,/t\.cashOut/)
assert.match(ui,/t\.duelCashOutRetry/)
assert.doesNotMatch(
  ui,
  /!terminal && \(provisionalCoins === 1 \|\| provisionalCoins === 2\) && !requestPending && !fx/,
)

const {
  canShowGroupCashOutButton,
  isGroupCashOutButtonDisabled,
} = await import('../src/group/groupCashOutUi.ts')
assert.equal(canShowGroupCashOutButton(0, false), false)
assert.equal(canShowGroupCashOutButton(1, false), true)
assert.equal(canShowGroupCashOutButton(2, false), true)
assert.equal(canShowGroupCashOutButton(3, false), false)
assert.equal(canShowGroupCashOutButton(1, true), false)
assert.equal(canShowGroupCashOutButton(2, true), false)
assert.equal(isGroupCashOutButtonDisabled(false, false), false)
assert.equal(isGroupCashOutButtonDisabled(true, false), true)
assert.equal(isGroupCashOutButtonDisabled(false, true), true)
assert.equal(isGroupCashOutButtonDisabled(true, true), true)

const duelPlay=readFileSync(resolve(root,'src/components/DuelPlayScreen.tsx'),'utf8')
assert.match(duelPlay,/showCashOut \?/)
assert.doesNotMatch(duelPlay,/canOfferDuelCashOut\(round\)[^\n]*!requestPending/)
assert.doesNotMatch(duelPlay,/canOfferDuelCashOut\(round\)[^\n]*!openFxActive/)
assert.match(duelPlay,/disabled=\{requestPending \|\| openFxActive\}/)

const duel=readFileSync(resolve(root,'server/db/cashOutDuelRound.ts'),'utf8'); assert.match(duel,/provisional_coins in \(1, 2\)/)
console.log('verify:group-cash-out OK')
