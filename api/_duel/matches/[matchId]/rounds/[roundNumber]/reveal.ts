import {
  GetRoundRevealError,
  getRoundReveal,
  validateGetRoundRevealRequest,
  type GetRoundRevealResponse,
} from '../../../../../../server/duel/getRoundReveal.js'

type GetReveal = (
  request: ReturnType<typeof validateGetRoundRevealRequest>,
) => Promise<GetRoundRevealResponse>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(
  status: 400 | 404 | 405 | 500,
  code: 'invalid_request' | 'match_unavailable' | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'GET')
  return Response.json({ error: { code } }, { status, headers })
}

function routeValues(request: Request): { matchId: string; roundNumber: number } | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/rounds\/([^/]+)\/reveal\/?$/.exec(
    new URL(request.url).pathname,
  )
  if (!match) return null
  try {
    const roundText = decodeURIComponent(match[2])
    if (!/^[1-9][0-9]*$/.test(roundText)) return null
    return {
      matchId: decodeURIComponent(match[1]),
      roundNumber: Number(roundText),
    }
  } catch {
    return null
  }
}

export function createGetRoundRevealHandler(
  getReveal: GetReveal = getRoundReveal,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') return errorResponse(405, 'invalid_request')
    try {
      const route = routeValues(request)
      const input = validateGetRoundRevealRequest(
        route?.matchId,
        route?.roundNumber,
        request.headers.get('authorization'),
      )
      const response = await getReveal(input)
      return Response.json(response, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof GetRoundRevealError) {
        return error.code === 'INVALID_REQUEST'
          ? errorResponse(400, 'invalid_request')
          : errorResponse(404, 'match_unavailable')
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default { fetch: createGetRoundRevealHandler() }
