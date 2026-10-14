import {
  DailyPlayApiError,
  beginDailyRound,
  validateDailyPlayCommand,
} from '../../../../../server/daily/playApi.js'

type BeginRound = typeof beginDailyRound

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
    const match = /^\/api\/daily\/challenges\/([^/]+)\/rounds\/start$/.exec(
      new URL(request.url).pathname,
    )
    return match ? decodeURIComponent(match[1]!) : null
  } catch {
    return null
  }
}

function mapError(error: DailyPlayApiError): Response {
  if (error.code === 'INVALID_REQUEST') return errorResponse(400, 'invalid_request')
  if (error.code === 'UNAUTHORIZED') return errorResponse(401, 'unauthorized')
  if (error.code === 'NOT_FOUND') return errorResponse(404, 'play_unavailable')
  if (error.code === 'ALREADY_ACTIVE') return errorResponse(409, 'already_active')
  if (error.code === 'COMPLETED') return errorResponse(409, 'cannot_start')
  if (error.code === 'CHALLENGE_ENDED') {
    return errorResponse(409, 'challenge_ended')
  }
  return errorResponse(409, 'cannot_start')
}

export function createDailyRoundStartHandler(
  begin: BeginRound = beginDailyRound,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return errorResponse(405, 'invalid_request', 'POST')
    }
    try {
      const result = await begin(
        validateDailyPlayCommand(
          routeDate(request),
          request.headers.get('authorization'),
          request.headers.get('idempotency-key'),
        ),
      )
      return Response.json(result, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof DailyPlayApiError) return mapError(error)
      return errorResponse(503, 'service_unavailable')
    }
  }
}

export default { fetch: createDailyRoundStartHandler() }
