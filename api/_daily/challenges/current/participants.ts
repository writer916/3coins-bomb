import {
  DAILY_JOIN_BODY_MAX_BYTES,
  DailyParticipantApiError,
  joinCurrentDailyChallenge,
  validateDailyJoinRequest,
} from '../../../../server/daily/participantApi.js'
import { DailyParticipantError } from '../../../../server/daily/dailyParticipant.js'

type Join = typeof joinCurrentDailyChallenge

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function response(status: number, code: string, allow?: string): Response {
  const headers = new Headers(JSON_HEADERS)
  if (allow) headers.set('Allow', allow)
  return Response.json({ error: { code } }, { status, headers })
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > DAILY_JOIN_BODY_MAX_BYTES
    ) {
      throw new DailyParticipantApiError('INVALID_REQUEST')
    }
  }
  if (!request.body) throw new DailyParticipantApiError('INVALID_REQUEST')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > DAILY_JOIN_BODY_MAX_BYTES) {
      await reader.cancel()
      throw new DailyParticipantApiError('INVALID_REQUEST')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
  } catch {
    throw new DailyParticipantApiError('INVALID_REQUEST')
  }
}

export function createDailyJoinHandler(
  join: Join = joinCurrentDailyChallenge,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return response(405, 'invalid_request', 'POST')
    if (
      request.headers.get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase() !== 'application/json'
    ) {
      return response(400, 'invalid_request')
    }
    try {
      const result = await join(validateDailyJoinRequest(await readJsonBody(request)))
      return Response.json(result, { status: 201, headers: JSON_HEADERS })
    } catch (error) {
      if (error instanceof DailyParticipantApiError) {
        return response(400, 'invalid_request')
      }
      if (error instanceof DailyParticipantError) {
        if (error.code === 'INVALID_REQUEST') return response(400, 'invalid_request')
        if (error.code === 'CHALLENGE_UNAVAILABLE') {
          return response(409, 'challenge_unavailable')
        }
        if (error.code === 'QUESTION_SET_UNAVAILABLE') {
          return response(503, 'question_set_unavailable')
        }
        if (error.code === 'JOIN_UNAVAILABLE') {
          return response(409, 'join_unavailable')
        }
        return response(503, 'service_unavailable')
      }
      return response(500, 'internal_error')
    }
  }
}

export default { fetch: createDailyJoinHandler() }
