import { randomUuid, type RandomUuidCrypto } from '../browser/randomUuid'
import {
  GROUP_FORMATION_VERSION,
  GROUP_ROUNDS_MAX,
  GROUP_RULE_VERSION,
  validateGroupPlacement,
  validateGroupNickname,
  judgeGroupBag,
  type GroupLocalOpenResult,
  type GroupRoundPlacement,
} from './groupDomain'
import { readGroupHost, readGroupParticipant, type GroupStorageAdapter } from './groupPersistence'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface GroupPlayState {
  readonly groupId: string
  readonly totalRounds: number
  readonly groupStatus: 'open' | 'closed'
  readonly participant: { readonly id: string; readonly displayNickname: string; readonly completed: boolean; readonly excluded: boolean }
  readonly completedRounds: number
  readonly nextRoundNumber: number | null
  readonly activeAttempt: { readonly roundNumber: number; readonly startedAt: string; readonly openedBagCount: number } | null
}
export interface GroupPlacementSet {
  readonly groupId: string
  readonly totalRounds: number
  readonly formationVersion: typeof GROUP_FORMATION_VERSION
  readonly ruleVersion: typeof GROUP_RULE_VERSION
  readonly placements: readonly GroupRoundPlacement[]
}
export interface GroupPlayReady {
  readonly state: GroupPlayState
  readonly placements: GroupPlacementSet
  readonly currentPlacement: GroupRoundPlacement
}
export interface GroupOpenResult {
  readonly groupId: string
  readonly roundNumber: number
  readonly bagNumber: number
  readonly openOrder: number
  readonly outcome: 'empty' | 'coins' | 'bomb'
  readonly coinsFound: 0 | 1 | 2 | 3
  readonly provisionalCoins: 0 | 1 | 2 | 3
  readonly openedBagCount: number
  readonly roundEnded: boolean
  readonly endReason: 'bombed' | 'cleared' | null
  readonly capturedCoins: 0 | 1 | 2 | 3
}
export interface GroupOpenCommand { readonly groupId: string; readonly bagNumber: number; readonly requestId: string }
export interface GroupCashOutResult { readonly groupId: string; readonly roundNumber: number; readonly endReason: 'cashed_out'; readonly capturedCoins: 1 | 2; readonly openedBagCount: number; readonly participantCompleted: boolean }
export interface GroupCashOutCommand { readonly groupId: string; readonly requestId: string }
export interface GroupProgress { readonly groupId:string;readonly playerLimit:number;readonly acceptedCount:number;readonly completedCount:number;readonly status:'open'|'closed';readonly selfCompleted:boolean;readonly selfIsHostParticipant:boolean;readonly hostCloseAvailable:boolean }
export interface GroupResultEntry { readonly rank:number;readonly entryKey:string;readonly nickname:string;readonly isSelf:boolean;readonly totalCoins:number;readonly threeCoinsComplete:number;readonly coinBagHits:number;readonly totalOpens:number;readonly coinBagHitRate:{readonly numerator:number;readonly denominator:number} }
export interface GroupResult { readonly groupId:string;readonly totalRounds:number;readonly playerLimit:number;readonly acceptedCount:number;readonly completedCount:number;readonly status:'closed';readonly ranking:readonly GroupResultEntry[] }
export interface GroupResultDetailOpen { readonly order:number;readonly kind:'empty'|'coins'|'bomb';readonly coinCount:0|1|2|3 }
export interface GroupResultDetailRound { readonly roundNumber:number;readonly endReason:'bombed'|'cashed_out'|'cleared'|'interrupted';readonly capturedCoins:0|1|2|3;readonly openedBagCount:number;readonly opens:readonly GroupResultDetailOpen[] }
export interface GroupResultDetail { readonly groupId:string;readonly entryKey:string;readonly nickname:string;readonly isSelf:boolean;readonly totalCoins:number;readonly threeCoinsComplete:number;readonly coinBagHits:number;readonly totalOpens:number;readonly coinBagHitRate:{readonly numerator:number;readonly denominator:number};readonly rounds:readonly GroupResultDetailRound[] }
const ENTRY_KEY=/^[A-Za-z0-9_-]{22}$/
export class GroupPlayClientError extends Error {
  constructor() { super('GROUP play could not be prepared.'); this.name = 'GroupPlayClientError' }
}
function fail(): never { throw new GroupPlayClientError() }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort(); const wanted = [...keys].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail()
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return fail()
  return value
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail()
  return value.toLowerCase()
}
function iso(value: unknown): string {
  if (typeof value !== 'string') return fail()
  try { if (new Date(value).toISOString() !== value) return fail() } catch { return fail() }
  return value
}

export function parseGroupPlayState(value: unknown, expectedGroupId: string): GroupPlayState {
  const state = record(value)
  exact(state, ['groupId', 'totalRounds', 'groupStatus', 'participant', 'completedRounds', 'nextRoundNumber', 'activeAttempt'])
  const participant = record(state.participant)
  exact(participant, ['id', 'displayNickname', 'completed', 'excluded'])
  const groupId = uuid(state.groupId)
  if (groupId !== uuid(expectedGroupId)) return fail()
  const totalRounds = integer(state.totalRounds, 1, GROUP_ROUNDS_MAX)
  const completedRounds = integer(state.completedRounds, 0, totalRounds)
  if ((state.groupStatus !== 'open' && state.groupStatus !== 'closed') || typeof participant.displayNickname !== 'string' || typeof participant.completed !== 'boolean' || typeof participant.excluded !== 'boolean') return fail()
  const active = state.activeAttempt === null ? null : record(state.activeAttempt)
  if (active) exact(active, ['roundNumber', 'startedAt', 'openedBagCount'])
  const activeAttempt = active ? { roundNumber: integer(active.roundNumber, 1, totalRounds), startedAt: iso(active.startedAt), openedBagCount: integer(active.openedBagCount, 0, 8) } : null
  const nextRoundNumber = state.nextRoundNumber === null ? null : integer(state.nextRoundNumber, 1, totalRounds)
  if ((activeAttempt && activeAttempt.roundNumber !== completedRounds + 1) || (activeAttempt && nextRoundNumber !== activeAttempt.roundNumber) || (((!activeAttempt && participant.completed) || participant.excluded || state.groupStatus === 'closed') && nextRoundNumber !== null)) return fail()
  return { groupId, totalRounds, groupStatus: state.groupStatus, participant: { id: uuid(participant.id), displayNickname: participant.displayNickname, completed: participant.completed, excluded: participant.excluded }, completedRounds, nextRoundNumber, activeAttempt }
}

export function parseGroupPlacementSet(value: unknown, expectedGroupId: string): GroupPlacementSet {
  const set = record(value)
  exact(set, ['groupId', 'totalRounds', 'formationVersion', 'ruleVersion', 'placements'])
  const groupId = uuid(set.groupId); if (groupId !== uuid(expectedGroupId)) return fail()
  const totalRounds = integer(set.totalRounds, 1, GROUP_ROUNDS_MAX)
  if (set.formationVersion !== GROUP_FORMATION_VERSION || set.ruleVersion !== GROUP_RULE_VERSION || !Array.isArray(set.placements) || set.placements.length !== totalRounds) return fail()
  try { return { groupId, totalRounds, formationVersion: GROUP_FORMATION_VERSION, ruleVersion: GROUP_RULE_VERSION, placements: set.placements.map((placement, index) => validateGroupPlacement(placement, index + 1)) } } catch { return fail() }
}

export function parseGroupOpenResult(value: unknown, command: GroupOpenCommand): GroupOpenResult {
  const result = record(value)
  exact(result, ['groupId', 'roundNumber', 'bagNumber', 'openOrder', 'outcome', 'coinsFound', 'provisionalCoins', 'openedBagCount', 'roundEnded', 'endReason', 'capturedCoins'])
  if (uuid(result.groupId) !== uuid(command.groupId) || result.bagNumber !== command.bagNumber) return fail()
  const outcome = result.outcome
  if (outcome !== 'empty' && outcome !== 'coins' && outcome !== 'bomb') return fail()
  const coinsFound = integer(result.coinsFound, 0, 3) as 0 | 1 | 2 | 3
  const provisionalCoins = integer(result.provisionalCoins, 0, 3) as 0 | 1 | 2 | 3
  const capturedCoins = integer(result.capturedCoins, 0, 3) as 0 | 1 | 2 | 3
  if (typeof result.roundEnded !== 'boolean' || (result.endReason !== null && result.endReason !== 'bombed' && result.endReason !== 'cleared')) return fail()
  return { groupId: command.groupId, roundNumber: integer(result.roundNumber, 1, 20), bagNumber: command.bagNumber, openOrder: integer(result.openOrder, 1, 8), outcome, coinsFound, provisionalCoins, openedBagCount: integer(result.openedBagCount, 1, 8), roundEnded: result.roundEnded, endReason: result.endReason, capturedCoins }
}
export function parseGroupCashOutResult(value: unknown, command: GroupCashOutCommand): GroupCashOutResult {
  const result = record(value); exact(result, ['groupId','roundNumber','endReason','capturedCoins','openedBagCount','participantCompleted'])
  if (uuid(result.groupId) !== uuid(command.groupId) || result.endReason !== 'cashed_out' || typeof result.participantCompleted !== 'boolean') return fail()
  const capturedCoins = integer(result.capturedCoins, 1, 2) as 1 | 2
  return { groupId: command.groupId, roundNumber: integer(result.roundNumber,1,20), endReason:'cashed_out', capturedCoins, openedBagCount: integer(result.openedBagCount,1,8), participantCompleted: result.participantCompleted }
}
export function parseGroupProgress(value:unknown,expectedGroupId:string):GroupProgress{const r=record(value);exact(r,['groupId','playerLimit','acceptedCount','completedCount','status','selfCompleted','selfIsHostParticipant','hostCloseAvailable']);if(uuid(r.groupId)!==uuid(expectedGroupId)||(r.status!=='open'&&r.status!=='closed')||typeof r.selfCompleted!=='boolean'||typeof r.selfIsHostParticipant!=='boolean'||typeof r.hostCloseAvailable!=='boolean')return fail();const playerLimit=integer(r.playerLimit,2,20),acceptedCount=integer(r.acceptedCount,0,playerLimit),completedCount=integer(r.completedCount,0,acceptedCount);return{groupId:expectedGroupId,playerLimit,acceptedCount,completedCount,status:r.status,selfCompleted:r.selfCompleted,selfIsHostParticipant:r.selfIsHostParticipant,hostCloseAvailable:r.hostCloseAvailable}}
export function parseGroupResult(value:unknown,expectedGroupId:string):GroupResult{const r=record(value);exact(r,['groupId','totalRounds','playerLimit','acceptedCount','completedCount','status','ranking']);if(uuid(r.groupId)!==uuid(expectedGroupId)||r.status!=='closed'||!Array.isArray(r.ranking))return fail();const totalRounds=integer(r.totalRounds,1,20),playerLimit=integer(r.playerLimit,2,20),acceptedCount=integer(r.acceptedCount,0,playerLimit),completedCount=integer(r.completedCount,0,acceptedCount);if(r.ranking.length!==completedCount||completedCount<1)return fail();let selfCount=0;const keys=new Set<string>();const ranking=r.ranking.map((value,index)=>{const entry=record(value);exact(entry,['rank','entryKey','nickname','isSelf','totalCoins','threeCoinsComplete','coinBagHits','totalOpens','coinBagHitRate']);const rate=record(entry.coinBagHitRate);exact(rate,['numerator','denominator']);if(typeof entry.isSelf!=='boolean'||typeof entry.entryKey!=='string'||!ENTRY_KEY.test(entry.entryKey)||keys.has(entry.entryKey))return fail();keys.add(entry.entryKey);let nickname:string;try{nickname=validateGroupNickname(entry.nickname)}catch{return fail()}if(entry.isSelf)selfCount+=1;const rank=integer(entry.rank,1,completedCount),totalCoins=integer(entry.totalCoins,0,totalRounds*3),threeCoinsComplete=integer(entry.threeCoinsComplete,0,totalRounds),totalOpens=integer(entry.totalOpens,0,totalRounds*8),coinBagHits=integer(entry.coinBagHits,0,totalOpens),numerator=integer(rate.numerator,0,totalOpens),denominator=integer(rate.denominator,0,totalRounds*8);if(numerator!==coinBagHits||denominator!==totalOpens||rank>index+1)return fail();return{rank,entryKey:entry.entryKey,nickname,isSelf:entry.isSelf,totalCoins,threeCoinsComplete,coinBagHits,totalOpens,coinBagHitRate:{numerator,denominator}}});if(selfCount>1||ranking[0]?.rank!==1||ranking.some((entry,index)=>index>0&&entry.rank!==ranking[index-1]!.rank&&entry.rank!==index+1))return fail();return{groupId:expectedGroupId,totalRounds,playerLimit,acceptedCount,completedCount,status:'closed',ranking}}
export function parseGroupResultDetail(
  value: unknown,
  expectedGroupId: string,
  expectedEntryKey: string,
): GroupResultDetail {
  const r = record(value)
  exact(r, [
    'groupId',
    'entryKey',
    'nickname',
    'isSelf',
    'totalCoins',
    'threeCoinsComplete',
    'coinBagHits',
    'totalOpens',
    'coinBagHitRate',
    'rounds',
  ])
  if (
    uuid(r.groupId) !== uuid(expectedGroupId) ||
    typeof r.entryKey !== 'string' ||
    r.entryKey !== expectedEntryKey ||
    !ENTRY_KEY.test(r.entryKey) ||
    typeof r.isSelf !== 'boolean' ||
    !Array.isArray(r.rounds) ||
    r.rounds.length < 1 ||
    r.rounds.length > 20
  ) {
    return fail()
  }
  const roundCount = r.rounds.length
  let nickname: string
  try {
    nickname = validateGroupNickname(r.nickname)
  } catch {
    return fail()
  }
  const rate = record(r.coinBagHitRate)
  exact(rate, ['numerator', 'denominator'])
  const totalCoins = integer(r.totalCoins, 0, roundCount * 3)
  const threeCoinsComplete = integer(r.threeCoinsComplete, 0, roundCount)
  const totalOpens = integer(r.totalOpens, 0, roundCount * 8)
  const coinBagHits = integer(r.coinBagHits, 0, totalOpens)
  const numerator = integer(rate.numerator, 0, totalOpens)
  const denominator = integer(rate.denominator, 0, roundCount * 8)
  if (numerator !== coinBagHits || denominator !== totalOpens) return fail()
  const rounds: GroupResultDetailRound[] = r.rounds.map((roundValue, index) => {
    const round = record(roundValue)
    exact(round, ['roundNumber', 'endReason', 'capturedCoins', 'openedBagCount', 'opens'])
    if (
      !Array.isArray(round.opens) ||
      (round.endReason !== 'bombed' &&
        round.endReason !== 'cashed_out' &&
        round.endReason !== 'cleared' &&
        round.endReason !== 'interrupted')
    ) {
      return fail()
    }
    const endReason = round.endReason
    const roundNumber = integer(round.roundNumber, 1, roundCount)
    if (roundNumber !== index + 1) return fail()
    const openedBagCount = integer(round.openedBagCount, 0, 8)
    if (openedBagCount !== round.opens.length) return fail()
    const capturedCoins = integer(round.capturedCoins, 0, 3) as 0 | 1 | 2 | 3
    const opens: GroupResultDetailOpen[] = round.opens.map((openValue, openIndex) => {
      const opened = record(openValue)
      exact(opened, ['order', 'kind', 'coinCount'])
      if (opened.kind !== 'empty' && opened.kind !== 'coins' && opened.kind !== 'bomb') {
        return fail()
      }
      const kind = opened.kind
      const order = integer(opened.order, 1, 8)
      if (order !== openIndex + 1) return fail()
      const coinCount = integer(opened.coinCount, 0, 3) as 0 | 1 | 2 | 3
      if (kind === 'empty' && coinCount !== 0) return fail()
      if (kind === 'bomb' && coinCount !== 0) return fail()
      if (kind === 'coins' && coinCount < 1) return fail()
      return { order, kind, coinCount }
    })
    return { roundNumber, endReason, capturedCoins, openedBagCount, opens }
  })
  return {
    groupId: expectedGroupId,
    entryKey: expectedEntryKey,
    nickname,
    isSelf: r.isSelf,
    totalCoins,
    threeCoinsComplete,
    coinBagHits,
    totalOpens,
    coinBagHitRate: { numerator, denominator },
    rounds,
  }
}

async function json(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init); if (!response.ok) return fail()
  try { return await response.json() as unknown } catch { return fail() }
}

export function createGroupPlayClient(dependencies: { readonly storage: GroupStorageAdapter; readonly fetch: typeof fetch; readonly crypto: RandomUuidCrypto }) {
  function access(groupId: string) {
    const participant = readGroupParticipant(dependencies.storage, groupId); if (!participant) return fail()
    return { Authorization: `Bearer ${participant.token}` }
  }
  return {
    createRequestId() { return randomUuid(dependencies.crypto) },
    async getState(groupId: string) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/play`, { method: 'GET', headers: access(groupId) }), groupId) },
    async getPlacements(groupId: string) { return parseGroupPlacementSet(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/placements`, { method: 'GET', headers: access(groupId) }), groupId) },
    async startRound(groupId: string, requestId: string = randomUuid(dependencies.crypto)) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/rounds/start`, { method: 'POST', headers: { ...access(groupId), 'Idempotency-Key': requestId } }), groupId) },
    async resume(groupId: string, requestId: string = randomUuid(dependencies.crypto)) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/play/resume`, { method: 'POST', headers: { ...access(groupId), 'Idempotency-Key': requestId } }), groupId) },
    createOpenCommand(groupId: string, bagNumber: number): GroupOpenCommand {
      return { groupId: uuid(groupId), bagNumber: integer(bagNumber, 1, 8), requestId: randomUuid(dependencies.crypto) }
    },
    async openBag(command: GroupOpenCommand): Promise<GroupOpenResult> {
      const response = await dependencies.fetch(`/api/group/matches/${encodeURIComponent(command.groupId)}/open`, {
        method: 'POST',
        headers: { ...access(command.groupId), 'Idempotency-Key': command.requestId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bagNumber: command.bagNumber }),
      })
      if (!response.ok) return fail()
      let value: unknown
      try { value = await response.json() as unknown } catch { return fail() }
      return parseGroupOpenResult(value, command)
    },
    createCashOutCommand(groupId: string): GroupCashOutCommand { return { groupId: uuid(groupId), requestId: randomUuid(dependencies.crypto) } },
    async cashOut(command: GroupCashOutCommand): Promise<GroupCashOutResult> {
      return parseGroupCashOutResult(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(command.groupId)}/cash-out`, { method:'POST', headers:{ ...access(command.groupId), 'Idempotency-Key':command.requestId } }), command)
    },
    async getProgress(groupId:string){return parseGroupProgress(await json(dependencies.fetch,`/api/group/matches/${encodeURIComponent(groupId)}/progress`,{method:'GET',headers:access(groupId)}),groupId)},
    async getResult(groupId:string){return parseGroupResult(await json(dependencies.fetch,`/api/group/matches/${encodeURIComponent(groupId)}/result`,{method:'GET',headers:access(groupId)}),groupId)},
    async getResultDetail(groupId:string,entryKey:string){if(!ENTRY_KEY.test(entryKey))return fail();return parseGroupResultDetail(await json(dependencies.fetch,`/api/group/matches/${encodeURIComponent(groupId)}/result/${encodeURIComponent(entryKey)}`,{method:'GET',headers:access(groupId)}),groupId,entryKey)},
    hasHostCapability(groupId:string){return readGroupHost(dependencies.storage,groupId)!==null},
    async closeGroup(groupId:string,requestId:string){const host=readGroupHost(dependencies.storage,groupId);if(!host)return fail();return parseGroupProgress(await json(dependencies.fetch,`/api/group/matches/${encodeURIComponent(groupId)}/close`,{method:'POST',headers:{Authorization:`Bearer ${host.hostToken}`,'Idempotency-Key':requestId}}),groupId)},
  }
}

export function createGroupPlayBootstrapCoordinator(client: ReturnType<typeof createGroupPlayClient>) {
  let inFlight: Promise<GroupPlayReady> | null = null
  let cached: GroupPlacementSet | null = null
  let resumeRequestId: string | null = null
  let startRequestId: string | null = null
  let pendingOpen: GroupOpenCommand | null = null
  let pendingCashOut: GroupCashOutCommand | null = null
  let closeRequestId: string | null = null
  let openInFlight = false
  return { run(groupId: string, explicitResume: boolean): Promise<GroupPlayReady> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      let state: GroupPlayState
      if (explicitResume) {
        resumeRequestId ??= client.createRequestId()
        state = await client.resume(groupId, resumeRequestId)
        resumeRequestId = null
      } else {
        state = await client.getState(groupId)
      }
      const placements = cached?.groupId === groupId ? cached : await client.getPlacements(groupId); cached = placements
      if (!state.activeAttempt && state.nextRoundNumber !== null) {
        startRequestId ??= client.createRequestId()
        state = await client.startRound(groupId, startRequestId)
        startRequestId = null
      }
      if (!state.activeAttempt) return fail()
      const currentPlacement = placements.placements[state.activeAttempt.roundNumber - 1]
      if (!currentPlacement || currentPlacement.roundNumber !== state.activeAttempt.roundNumber) return fail()
      return { state, placements, currentPlacement }
    })().finally(() => { inFlight = null })
    return inFlight
  },
  getLocalOpenResult(groupId: string, roundNumber: number, bagCount: number, bagNumber: number): GroupLocalOpenResult {
    if (cached?.groupId !== groupId) return fail()
    const placement = cached.placements[roundNumber - 1]
    if (!placement || placement.roundNumber !== roundNumber || placement.bagCount !== bagCount) return fail()
    return judgeGroupBag(placement, bagNumber)
  },
  getPendingOpen() { return pendingOpen },
  getPendingCashOut() { return pendingCashOut },
  async open(groupId: string, bagNumber: number): Promise<GroupOpenResult> {
    if (openInFlight || pendingCashOut) return fail()
    if (pendingOpen && (pendingOpen.groupId !== groupId || pendingOpen.bagNumber !== bagNumber)) return fail()
    pendingOpen ??= client.createOpenCommand(groupId, bagNumber)
    openInFlight = true
    try {
      const result = await client.openBag(pendingOpen)
      pendingOpen = null
      return result
    } finally { openInFlight = false }
  },
  async cashOut(groupId: string): Promise<GroupCashOutResult> {
    if (openInFlight || pendingOpen) return fail()
    pendingCashOut ??= client.createCashOutCommand(groupId)
    if (pendingCashOut.groupId !== groupId) return fail()
    openInFlight = true
    try { const result = await client.cashOut(pendingCashOut); pendingCashOut = null; return result }
    finally { openInFlight = false }
  },
  getProgress(groupId:string){return client.getProgress(groupId)},
  getResult(groupId:string){return client.getResult(groupId)},
  getResultDetail(groupId:string,entryKey:string){return client.getResultDetail(groupId,entryKey)},
  hasHostCapability(groupId:string){return client.hasHostCapability(groupId)},
  async closeGroup(groupId:string){closeRequestId??=client.createRequestId();const result=await client.closeGroup(groupId,closeRequestId);closeRequestId=null;return result},
  async startNext(groupId: string): Promise<GroupPlayReady> {
    startRequestId ??= client.createRequestId()
    const state = await client.startRound(groupId, startRequestId)
    startRequestId = null
    if (!state.activeAttempt || cached?.groupId !== groupId) return fail()
    const currentPlacement = cached.placements[state.activeAttempt.roundNumber - 1]
    if (!currentPlacement) return fail()
    return { state, placements: cached, currentPlacement }
  } }
}
