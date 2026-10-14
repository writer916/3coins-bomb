import {
  DAILY_OPEN_BODY_MAX_BYTES,
  DailyOpenApiError,
  openDailyChallengeBag,
  validateDailyOpenRequest,
} from '../../../../../server/daily/openBag.js'

type OpenBag = typeof openDailyChallengeBag

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
    const match = /^\/api\/daily\/challenges\/([^/]+)\/rounds\/open$/.exec(
      new URL(request.url).pathname,
    )
    return match ? decodeURIComponent(match[1]!) : null
  } catch {
    return null
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > DAILY_OPEN_BODY_MAX_BYTES) {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new DailyOpenApiError('INVALID_REQUEST')
  }
}

function mapError(error: DailyOpenApiError): Response {
  if (error.code === 'INVALID_REQUEST') return errorResponse(400, 'invalid_request')
  if (error.code === 'UNAUTHORIZED') return errorResponse(401, 'unauthorized')
  if (error.code === 'UNAVAILABLE') return errorResponse(404, 'play_unavailable')
  return errorResponse(409, 'open_conflict')
}

export function createDailyRoundOpenHandler(
  open: OpenBag = openDailyChallengeBag,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return errorResponse(405, 'invalid_request', 'POST')
    }
    if (
      request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
    ) {
      return errorResponse(400, 'invalid_request')
    }
    try {
      const result = await open(
        validateDailyOpenRequest(
          routeDate(request),
          request.headers.get('authorization'),
          request.headers.get('idempotency-key'),
          await readJsonBody(request),
        ),
      )
      return Response.json(result, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof DailyOpenApiError) return mapError(error)
      return errorResponse(503, 'service_unavailable')
    }
  }
}

export default { fetch: createDailyRoundOpenHandler() }
