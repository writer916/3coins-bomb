import { validateCreateRequestId } from '../auth/duelTokens.js'
import { hashGroupCapability, validateGroupParticipantCapability } from '../auth/groupTokens.js'
import { parseBearerToken } from '../auth/duelTokens.js'
import { persistGroupBagOpen, type GroupOpenView, type OpenGroupBagResult } from '../db/openGroupBag.js'

export const GROUP_OPEN_BODY_MAX_BYTES = 128
export class GroupOpenError extends Error {
  readonly code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CONFLICT'
  constructor(code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CONFLICT') {
    super('The GROUP OPEN request could not be completed.')
    this.name = 'GroupOpenError'; this.code = code
  }
}
export interface GroupOpenRequest {
  readonly groupId: string
  readonly participantToken: string
  readonly requestId: string
  readonly bagNumber: number
}
export function validateGroupOpenRequest(groupId: unknown, authorization: unknown, requestId: unknown, body: unknown): GroupOpenRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new GroupOpenError('INVALID_REQUEST')
  const record = body as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !('bagNumber' in record) || !Number.isInteger(record.bagNumber) || (record.bagNumber as number) < 1 || (record.bagNumber as number) > 8) throw new GroupOpenError('INVALID_REQUEST')
  try {
    return {
      groupId: validateCreateRequestId(groupId),
      participantToken: validateGroupParticipantCapability(parseBearerToken(authorization)),
      requestId: validateCreateRequestId(requestId),
      bagNumber: record.bagNumber as number,
    }
  } catch { throw new GroupOpenError('UNAVAILABLE') }
}
export async function openGroupBag(request: GroupOpenRequest, persist: (input: {
  groupId: string; participantTokenHash: string; requestId: string; bagNumber: number
}) => Promise<OpenGroupBagResult> = persistGroupBagOpen): Promise<GroupOpenView> {
  const result = await persist({
    groupId: request.groupId,
    participantTokenHash: hashGroupCapability(request.participantToken),
    requestId: request.requestId,
    bagNumber: request.bagNumber,
  })
  if (result.status === 'opened' || result.status === 'retry') return result.view
  throw new GroupOpenError(result.status === 'unavailable' ? 'UNAVAILABLE' : 'CONFLICT')
}
