import {
  GROUP_FORMATION_VERSION,
  GROUP_ROUNDS_MAX,
  GROUP_RULE_VERSION,
  validateGroupPlacement,
  type GroupRoundPlacement,
} from './groupDomain'
import { readGroupParticipant, type GroupStorageAdapter } from './groupPersistence'

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

async function json(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init); if (!response.ok) return fail()
  try { return await response.json() as unknown } catch { return fail() }
}

export function createGroupPlayClient(dependencies: { readonly storage: GroupStorageAdapter; readonly fetch: typeof fetch; readonly crypto: Pick<Crypto, 'randomUUID'> }) {
  function access(groupId: string) {
    const participant = readGroupParticipant(dependencies.storage, groupId); if (!participant) return fail()
    return { Authorization: `Bearer ${participant.token}` }
  }
  return {
    createRequestId() { return dependencies.crypto.randomUUID() },
    async getState(groupId: string) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/play`, { method: 'GET', headers: access(groupId) }), groupId) },
    async getPlacements(groupId: string) { return parseGroupPlacementSet(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/placements`, { method: 'GET', headers: access(groupId) }), groupId) },
    async startRound(groupId: string, requestId: string = dependencies.crypto.randomUUID()) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/rounds/start`, { method: 'POST', headers: { ...access(groupId), 'Idempotency-Key': requestId } }), groupId) },
    async resume(groupId: string, requestId: string = dependencies.crypto.randomUUID()) { return parseGroupPlayState(await json(dependencies.fetch, `/api/group/matches/${encodeURIComponent(groupId)}/play/resume`, { method: 'POST', headers: { ...access(groupId), 'Idempotency-Key': requestId } }), groupId) },
  }
}

export function createGroupPlayBootstrapCoordinator(client: ReturnType<typeof createGroupPlayClient>) {
  let inFlight: Promise<GroupPlayReady> | null = null
  let cached: GroupPlacementSet | null = null
  let resumeRequestId: string | null = null
  let startRequestId: string | null = null
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
  } }
}
