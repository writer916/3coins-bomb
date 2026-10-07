import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import { hashGroupCapability, validateGroupParticipantCapability } from '../auth/groupTokens.js'
import { getGroupResultForParticipant, type GroupResultView } from '../db/getGroupResult.js'

export class GetGroupResultError extends Error {
  constructor() {
    super('The GROUP result is unavailable.')
    this.name = 'GetGroupResultError'
  }
}

export interface GetGroupResultRequest { readonly groupId: string; readonly participantToken: string }

export function validateGetGroupResultRequest(groupId: unknown, authorization: unknown): GetGroupResultRequest {
  try {
    return {
      groupId: validateCreateRequestId(groupId),
      participantToken: validateGroupParticipantCapability(parseBearerToken(authorization)),
    }
  } catch { throw new GetGroupResultError() }
}

export async function getGroupResult(request: GetGroupResultRequest, read = getGroupResultForParticipant): Promise<GroupResultView> {
  const snapshot = await read(request.groupId, hashGroupCapability(request.participantToken))
  if (!snapshot || snapshot.kind !== 'closed') throw new GetGroupResultError()
  return snapshot.view
}
