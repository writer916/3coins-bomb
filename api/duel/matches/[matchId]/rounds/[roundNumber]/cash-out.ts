import {
  CashOutRoundError,
  cashOutRound,
  validateCashOutRoundRequest,
  type CashOutRoundResponse,
} from '../../../../../../server/duel/cashOutRound.js'

type CashOut = (
  request: ReturnType<typeof validateCashOutRoundRequest>,
) => Promise<CashOutRoundResponse>

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

/** CASH OUT is a bodyless command — only enough bytes to reject unexpected payloads. */
const CASH_OUT_BODY_MAX_BYTES = 256

function errorResponse(
  status: 400 | 404 | 405 | 409 | 500,
  code:
    | 'invalid_request'
    | 'match_unavailable'
    | 'cash_out_conflict'
    | 'internal_error',
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (status === 405) headers.set('Allow', 'POST')
  return Response.json({ error: { code } }, { status, headers })
}

function routeValues(request: Request): { matchId: string; roundNumber: number } | null {
  const match = /^\/api\/duel\/matches\/([^/]+)\/rounds\/([^/]+)\/cash-out\/?$/.exec(
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

/**
 * Accept no body / null body / empty body (including non-null empty streams that
 * real browser→edge POSTs may present). Reject any non-empty payload bytes.
 */
async function assertCashOutHasNoPayload(request: Request): Promise<void> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > CASH_OUT_BODY_MAX_BYTES
    ) {
      throw new CashOutRoundError('INVALID_REQUEST')
    }
    if (parsedLength > 0) {
      throw new CashOutRoundError('INVALID_REQUEST')
    }
  }
  if (!request.body) return

  const reader = request.body.getReader()
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > 0) {
      await reader.cancel()
      throw new CashOutRoundError('INVALID_REQUEST')
    }
  }
}

export function createCashOutRoundHandler(
  cashOut: CashOut = cashOutRound,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return errorResponse(405, 'invalid_request')
    try {
      await assertCashOutHasNoPayload(request)
      const route = routeValues(request)
      const input = validateCashOutRoundRequest(
        route?.matchId,
        route?.roundNumber,
        request.headers.get('authorization'),
        request.headers.get('idempotency-key'),
      )
      const response = await cashOut(input)
      return Response.json(response, { status: 200, headers: JSON_HEADERS })
    } catch (error: unknown) {
      if (error instanceof CashOutRoundError) {
        if (error.code === 'INVALID_REQUEST') {
          return errorResponse(400, 'invalid_request')
        }
        if (error.code === 'MATCH_UNAVAILABLE') {
          return errorResponse(404, 'match_unavailable')
        }
        return errorResponse(409, 'cash_out_conflict')
      }
      return errorResponse(500, 'internal_error')
    }
  }
}

export default { fetch: createCashOutRoundHandler() }
