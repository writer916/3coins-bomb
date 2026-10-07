import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import { hashGroupCapability, validateGroupParticipantCapability } from '../auth/groupTokens.js'
import { persistGroupRoundCashOut, type CashOutGroupRoundResult, type GroupCashOutView } from '../db/cashOutGroupRound.js'

export class GroupCashOutError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CONFLICT'
  constructor(code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CONFLICT') { super('The GROUP CASH OUT request could not be completed.'); this.name = 'GroupCashOutError'; this.code = code }
}
export function validateGroupCashOutRequest(groupId: unknown, authorization: unknown, requestId: unknown) {
  try { return { groupId: validateCreateRequestId(groupId), participantToken: validateGroupParticipantCapability(parseBearerToken(authorization)), requestId: validateCreateRequestId(requestId) } }
  catch { throw new GroupCashOutError('UNAVAILABLE') }
}
export async function cashOutGroupRound(request: ReturnType<typeof validateGroupCashOutRequest>, persist: (input: { groupId: string; participantTokenHash: string; requestId: string }) => Promise<CashOutGroupRoundResult> = persistGroupRoundCashOut): Promise<GroupCashOutView> {
  const result = await persist({ groupId: request.groupId, participantTokenHash: hashGroupCapability(request.participantToken), requestId: request.requestId })
  if (result.status === 'cashed_out' || result.status === 'retry') return result.view
  throw new GroupCashOutError(result.status === 'unavailable' ? 'UNAVAILABLE' : 'CONFLICT')
}
