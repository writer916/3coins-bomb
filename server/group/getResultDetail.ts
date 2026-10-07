import { parseBearerToken, validateCreateRequestId } from '../auth/duelTokens.js'
import { hashGroupCapability, validateGroupParticipantCapability } from '../auth/groupTokens.js'
import {
  getGroupResultDetailForParticipant,
  type GroupResultDetailView,
} from '../db/getGroupResult.js'
import { validateGroupResultEntryKey } from './resultEntryKey.js'

export class GetGroupResultDetailError extends Error {
  constructor() {
    super('The GROUP result detail is unavailable.')
    this.name = 'GetGroupResultDetailError'
  }
}

export interface GetGroupResultDetailRequest {
  readonly groupId: string
  readonly entryKey: string
  readonly participantToken: string
}

export function validateGetGroupResultDetailRequest(
  groupId: unknown,
  entryKey: unknown,
  authorization: unknown,
): GetGroupResultDetailRequest {
  try {
    return {
      groupId: validateCreateRequestId(groupId),
      entryKey: validateGroupResultEntryKey(entryKey),
      participantToken: validateGroupParticipantCapability(parseBearerToken(authorization)),
    }
  } catch {
    throw new GetGroupResultDetailError()
  }
}

export async function getGroupResultDetail(
  request: GetGroupResultDetailRequest,
  read = getGroupResultDetailForParticipant,
): Promise<GroupResultDetailView> {
  const snapshot = await read(
    request.groupId,
    hashGroupCapability(request.participantToken),
    request.entryKey,
  )
  if (!snapshot || snapshot.kind !== 'closed') throw new GetGroupResultDetailError()
  return snapshot.view
}
