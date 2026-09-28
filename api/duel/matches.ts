import {
  CreateDuelMatchError,
  DUEL_CREATE_BODY_MAX_BYTES,
  createDuelMatch,
  validateCreateDuelMatchInput,
  type CreateDuelMatchResult,
} from '../../server/duel/createMatch.js'

type CreateMatch = (
  input: ReturnType<typeof validateCreateDuelMatchInput>,
) => Promise<CreateDuelMatchResult>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(
  status: 400 | 405 | 409 | 500,
  code: 'invalid_request' | 'create_request_conflict' | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

async function readLimitedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > DUEL_CREATE_BODY_MAX_BYTES
    ) {
      throw new CreateDuelMatchError('INVALID_REQUEST')
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
    if (byteLength > DUEL_CREATE_BODY_MAX_BYTES) {
      await reader.cancel()
      throw new CreateDuelMatchError('INVALID_REQUEST')
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
    throw new CreateDuelMatchError('INVALID_REQUEST')
  }
}

export function createDuelMatchesHandler(
  createMatch: CreateMatch = createDuelMatch,
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
        throw new CreateDuelMatchError('INVALID_REQUEST')
      }
      const input = validateCreateDuelMatchInput(
        request.headers.get('idempotency-key'),
        body,
      )
      const result = await createMatch(input)
      return Response.json(result.response, {
        status: result.created ? 201 : 200,
        headers: JSON_HEADERS,
      })
    } catch (error: unknown) {
      if (error instanceof CreateDuelMatchError) {
        return errorResponse(
          error.code === 'INVALID_REQUEST' ? 400 : 409,
          error.code === 'INVALID_REQUEST'
            ? 'invalid_request'
            : 'create_request_conflict',
        )
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default {
  fetch: createDuelMatchesHandler(),
}
