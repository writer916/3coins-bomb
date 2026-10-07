import {
  GROUP_OPEN_BODY_MAX_BYTES,
  GroupOpenError,
  openGroupBag,
  validateGroupOpenRequest,
} from '../../../../server/group/openBag.js'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
function groupId(request: Request): string | null {
  const match = /^\/api\/group\/matches\/([^/]+)\/open\/?$/.exec(new URL(request.url).pathname)
  try { return match ? decodeURIComponent(match[1]!) : null } catch { return null }
}
async function body(request: Request): Promise<unknown> {
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > GROUP_OPEN_BODY_MAX_BYTES) throw new GroupOpenError('INVALID_REQUEST')
  try { return JSON.parse(text) as unknown } catch { throw new GroupOpenError('INVALID_REQUEST') }
}
export function createGroupOpenHandler(open = openGroupBag) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return Response.json({ error: { code: 'invalid_request' } }, { status: 405, headers: { ...headers, Allow: 'POST' } })
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return Response.json({ error: { code: 'invalid_request' } }, { status: 400, headers })
    try {
      const result = await open(validateGroupOpenRequest(groupId(request), request.headers.get('authorization'), request.headers.get('idempotency-key'), await body(request)))
      return Response.json(result, { status: 200, headers })
    } catch (error: unknown) {
      if (error instanceof GroupOpenError) {
        const status = error.code === 'INVALID_REQUEST' ? 400 : error.code === 'CONFLICT' ? 409 : 404
        return Response.json({ error: { code: error.code === 'CONFLICT' ? 'open_conflict' : error.code === 'UNAVAILABLE' ? 'play_unavailable' : 'invalid_request' } }, { status, headers })
      }
      return Response.json({ error: { code: 'internal_error' } }, { status: 500, headers })
    }
  }
}
export default { fetch: createGroupOpenHandler() }
