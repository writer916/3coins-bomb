import {
  DUEL_LOCK_BODY_MAX_BYTES,
  LockPlacementsError,
  lockPlacements,
  validateLockPlacementsRequest,
  type LockPlacementsResponse,
} from '../../../../../server/duel/lockPlacements.js'

type Lock = (
  request: ReturnType<typeof validateLockPlacementsRequest>,
) => Promise<LockPlacementsResponse>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(
  status: 400 | 404 | 405 | 409 | 500,
  code:
    | 'invalid_request'
    | 'match_unavailable'
    | 'placement_conflict'
    | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

function matchIdFromUrl(request: Request): string | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/placements\/lock\/?$/.exec(
    new URL(request.url).pathname,
  )
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

async function readLimitedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > DUEL_LOCK_BODY_MAX_BYTES
    ) {
      throw new LockPlacementsError('INVALID_REQUEST')
    }
  }
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > DUEL_LOCK_BODY_MAX_BYTES) {
      await reader.cancel()
      throw new LockPlacementsError('INVALID_REQUEST')
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
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new LockPlacementsError('INVALID_REQUEST')
  }
}

export function createLockPlacementsHandler(
  lock: Lock = lockPlacements,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return errorResponse(405, 'invalid_request')
    }
    const contentType = request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase()
    if (contentType !== 'application/json') {
      return errorResponse(400, 'invalid_request')
    }
    try {
      const rawBody = await readLimitedBody(request)
      let body: unknown
      try {
        body = JSON.parse(rawBody)
      } catch {
        throw new LockPlacementsError('INVALID_REQUEST')
      }
      const input = validateLockPlacementsRequest(
        matchIdFromUrl(request),
        request.headers.get('authorization'),
        body,
      )
      const response = await lock(input)
      return Response.json(response, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof LockPlacementsError) {
        if (error.code === 'INVALID_REQUEST') {
          return errorResponse(400, 'invalid_request')
        }
        if (error.code === 'MATCH_UNAVAILABLE') {
          return errorResponse(404, 'match_unavailable')
        }
        return errorResponse(409, 'placement_conflict')
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default { fetch: createLockPlacementsHandler() }
