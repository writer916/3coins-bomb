import {
  GetDuelMatchError,
  getDuelMatch,
  validateGetDuelMatchRequest,
  type GetDuelMatchResponse,
} from '../../../server/duel/getMatch.js'

type GetMatch = (
  request: ReturnType<typeof validateGetDuelMatchRequest>,
) => Promise<GetDuelMatchResponse>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(
  status: 404 | 405 | 500,
  code: 'match_unavailable' | 'invalid_request' | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'GET')
  return Response.json({ error: { code } }, { status, headers })
}

function matchIdFromUrl(request: Request): string | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/?$/.exec(
    new URL(request.url).pathname,
  )
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

export function createGetDuelMatchHandler(
  getMatch: GetMatch = getDuelMatch,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') {
      return errorResponse(405, 'invalid_request')
    }

    try {
      const input = validateGetDuelMatchRequest(
        matchIdFromUrl(request),
        request.headers.get('authorization'),
      )
      const response = await getMatch(input)
      return Response.json(response, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof GetDuelMatchError) {
        return errorResponse(404, 'match_unavailable')
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default {
  fetch: createGetDuelMatchHandler(),
}
