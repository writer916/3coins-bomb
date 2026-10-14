import {
  DailyParticipantApiError,
  getDailyParticipant,
} from '../../../../server/daily/participantApi.js'

type GetParticipant = typeof getDailyParticipant

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function response(status: number, code: string, allow?: string): Response {
  const headers = new Headers(JSON_HEADERS)
  if (allow) headers.set('Allow', allow)
  return Response.json({ error: { code } }, { status, headers })
}

function routeDate(request: Request): string | null {
  try {
    const match = /^\/api\/daily\/challenges\/([^/]+)\/participant$/.exec(
      new URL(request.url).pathname,
    )
    return match ? decodeURIComponent(match[1]!) : null
  } catch {
    return null
  }
}

export function createDailyParticipantHandler(
  getParticipant: GetParticipant = getDailyParticipant,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') return response(405, 'invalid_request', 'GET')
    try {
      const result = await getParticipant(
        routeDate(request),
        request.headers.get('authorization'),
      )
      return Response.json(result, { status: 200, headers: JSON_HEADERS })
    } catch (error) {
      if (error instanceof DailyParticipantApiError) {
        if (error.code === 'INVALID_REQUEST') return response(400, 'invalid_request')
        if (error.code === 'UNAUTHORIZED') return response(401, 'unauthorized')
        return response(404, 'participant_not_found')
      }
      return response(503, 'service_unavailable')
    }
  }
}

export default { fetch: createDailyParticipantHandler() }
