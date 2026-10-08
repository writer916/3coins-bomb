import {
  GROUP_JOIN_BODY_MAX_BYTES,
  JoinGroupParticipantError,
  joinGroupParticipant,
  validateJoinGroupParticipantRequest,
  type JoinGroupParticipantResult,
} from '../../../../server/group/joinParticipant.js'

type JoinParticipant = (
  input: ReturnType<typeof validateJoinGroupParticipantRequest>,
) => Promise<JoinGroupParticipantResult>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function response(status: 400 | 405 | 409 | 500, code: string): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

function routeGroupId(request: Request): string | null {
  try {
    const match = /^\/api\/group\/matches\/([^/]+)\/join$/.exec(new URL(request.url).pathname)
    return match ? decodeURIComponent(match[1]!) : null
  } catch {
    return null
  }
}

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length !== null) {
    const parsed = Number(length)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > GROUP_JOIN_BODY_MAX_BYTES) {
      throw new JoinGroupParticipantError('INVALID_REQUEST')
    }
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > GROUP_JOIN_BODY_MAX_BYTES) {
    throw new JoinGroupParticipantError('INVALID_REQUEST')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new JoinGroupParticipantError('INVALID_REQUEST')
  }
}

export function createJoinGroupParticipantHandler(
  join: JoinParticipant = joinGroupParticipant,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return response(405, 'invalid_request')
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return response(400, 'invalid_request')
    }
    try {
      const input = validateJoinGroupParticipantRequest(
        routeGroupId(request),
        await readBody(request),
      )
      const result = await join(input)
      return Response.json(result.response, {
        status: result.joined ? 201 : 200,
        headers: JSON_HEADERS,
      })
    } catch (error: unknown) {
      if (error instanceof JoinGroupParticipantError) {
        return response(
          error.code === 'INVALID_REQUEST' ? 400 : 409,
          error.code === 'INVALID_REQUEST' ? 'invalid_request' : 'join_unavailable',
        )
      }
      return response(500, 'internal_error')
    }
  }
}

export default { fetch: createJoinGroupParticipantHandler() }
