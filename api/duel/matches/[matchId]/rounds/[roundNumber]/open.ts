import {
  DUEL_OPEN_BODY_MAX_BYTES,
  OpenBagError,
  openBag,
  validateOpenBagRequest,
  type OpenBagDependencies,
  type OpenBagResponse,
} from '../../../../../../server/duel/openBag.js'

type Open = (
  request: ReturnType<typeof validateOpenBagRequest>,
  dependencies?: Pick<OpenBagDependencies, 'onDatabaseTiming'>,
) => Promise<OpenBagResponse>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

type DatabaseTiming = {
  readonly startedAtMs: number
  readonly durationMs: number
}

function duration(value: number): string {
  return Math.max(0, Number.isFinite(value) ? value : 0).toFixed(2)
}

function serverTiming(
  functionStartedAtMs: number,
  functionFinishedAtMs: number,
  databaseTiming: DatabaseTiming | null,
): string {
  const appDuration = functionFinishedAtMs - functionStartedAtMs
  if (!databaseTiming) return `app;dur=${duration(appDuration)}`
  const preDatabase = databaseTiming.startedAtMs - functionStartedAtMs
  const postDatabase =
    functionFinishedAtMs - databaseTiming.startedAtMs - databaseTiming.durationMs
  return [
    `app;dur=${duration(appDuration)}`,
    `pre_db;dur=${duration(preDatabase)}`,
    `db;dur=${duration(databaseTiming.durationMs)}`,
    `post_db;dur=${duration(postDatabase)}`,
  ].join(', ')
}

function errorResponse(
  status: 400 | 404 | 405 | 409 | 500,
  code: 'invalid_request' | 'match_unavailable' | 'open_conflict' | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

function routeValues(request: Request): { matchId: string; roundNumber: number } | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/rounds\/([^/]+)\/open\/?$/.exec(
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

async function readLimitedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > DUEL_OPEN_BODY_MAX_BYTES
    ) {
      throw new OpenBagError('INVALID_REQUEST')
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
    if (byteLength > DUEL_OPEN_BODY_MAX_BYTES) {
      await reader.cancel()
      throw new OpenBagError('INVALID_REQUEST')
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
    throw new OpenBagError('INVALID_REQUEST')
  }
}

export function createOpenBagHandler(
  open: Open = openBag,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const functionStartedAtMs = performance.now()
    if (request.method !== 'POST') return errorResponse(405, 'invalid_request')
    const contentType = request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase()
    if (contentType !== 'application/json') {
      return errorResponse(400, 'invalid_request')
    }
    try {
      const route = routeValues(request)
      const rawBody = await readLimitedBody(request)
      let body: unknown
      try {
        body = JSON.parse(rawBody)
      } catch {
        throw new OpenBagError('INVALID_REQUEST')
      }
      const input = validateOpenBagRequest(
        route?.matchId,
        route?.roundNumber,
        request.headers.get('authorization'),
        request.headers.get('idempotency-key'),
        body,
      )
      let databaseTiming: DatabaseTiming | null = null
      const response = await open(input, {
        onDatabaseTiming: (timing) => {
          databaseTiming = timing
        },
      })
      const responseBody = JSON.stringify(response)
      const functionFinishedAtMs = performance.now()
      return new Response(responseBody, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'Server-Timing': serverTiming(
            functionStartedAtMs,
            functionFinishedAtMs,
            databaseTiming,
          ),
        },
      })
    } catch (error: unknown) {
      if (error instanceof OpenBagError) {
        if (error.code === 'INVALID_REQUEST') {
          return errorResponse(400, 'invalid_request')
        }
        if (error.code === 'MATCH_UNAVAILABLE') {
          return errorResponse(404, 'match_unavailable')
        }
        return errorResponse(409, 'open_conflict')
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default { fetch: createOpenBagHandler() }
