import {
  DailyRankingApiError,
  readDailyRanking,
  validateDailyRankingAuth,
} from '../../../../server/daily/rankingApi.js'

type ReadRanking = typeof readDailyRanking

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(status: number, code: string, allow?: string): Response {
  const headers = new Headers(JSON_HEADERS)
  if (allow) headers.set('Allow', allow)
  return Response.json({ error: { code } }, { status, headers })
}

function routeDate(request: Request): string | null {
  try {
    const match = /^\/api\/daily\/challenges\/([^/]+)\/ranking$/.exec(
      new URL(request.url).pathname,
    )
    return match ? decodeURIComponent(match[1]!) : null
  } catch {
    return null
  }
}

function mapError(error: DailyRankingApiError): Response {
  if (error.code === 'INVALID_REQUEST') return errorResponse(400, 'invalid_request')
  if (error.code === 'UNAUTHORIZED') return errorResponse(401, 'unauthorized')
  return errorResponse(404, 'ranking_unavailable')
}

export function createDailyRankingHandler(
  read: ReadRanking = readDailyRanking,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') {
      return errorResponse(405, 'invalid_request', 'GET')
    }
    try {
      const ranking = await read(
        validateDailyRankingAuth(
          routeDate(request),
          request.headers.get('authorization'),
        ),
      )
      return Response.json(ranking, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof DailyRankingApiError) return mapError(error)
      return errorResponse(503, 'service_unavailable')
    }
  }
}

export default { fetch: createDailyRankingHandler() }
