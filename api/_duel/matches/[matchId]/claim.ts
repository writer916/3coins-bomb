import {
  ClaimParticipantError,
  DUEL_CLAIM_BODY_MAX_BYTES,
  claimParticipant,
  validateClaimParticipantRequest,
  type ClaimParticipantResult,
} from '../../../../server/duel/claimParticipant.js'

type ClaimParticipant = (
  request: ReturnType<typeof validateClaimParticipantRequest>,
) => Promise<ClaimParticipantResult>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function errorResponse(
  status: 400 | 404 | 405 | 500,
  code: 'invalid_request' | 'invitation_unavailable' | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

function matchIdFromUrl(request: Request): string | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/claim\/?$/.exec(
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
      parsedLength > DUEL_CLAIM_BODY_MAX_BYTES
    ) {
      throw new ClaimParticipantError('INVALID_REQUEST')
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
    if (byteLength > DUEL_CLAIM_BODY_MAX_BYTES) {
      await reader.cancel()
      throw new ClaimParticipantError('INVALID_REQUEST')
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
    throw new ClaimParticipantError('INVALID_REQUEST')
  }
}

export function createClaimParticipantHandler(
  claim: ClaimParticipant = claimParticipant,
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
      const matchId = matchIdFromUrl(request)
      const rawBody = await readLimitedBody(request)
      let body: unknown
      try {
        body = JSON.parse(rawBody)
      } catch {
        throw new ClaimParticipantError('INVALID_REQUEST')
      }
      const claimRequest = validateClaimParticipantRequest(
        matchId,
        request.headers.get('authorization'),
        body,
      )
      const result = await claim(claimRequest)
      return Response.json(result.response, {
        status: result.claimed ? 201 : 200,
        headers: JSON_HEADERS,
      })
    } catch (error: unknown) {
      if (error instanceof ClaimParticipantError) {
        return errorResponse(
          error.code === 'INVALID_REQUEST' ? 400 : 404,
          error.code === 'INVALID_REQUEST'
            ? 'invalid_request'
            : 'invitation_unavailable',
        )
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default {
  fetch: createClaimParticipantHandler(),
}
