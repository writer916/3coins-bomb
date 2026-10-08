import {
  GroupPlayError,
  beginGroupRound,
  validateGroupPlayCommand,
} from '../../../../../server/group/play.js'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }

function groupId(request: Request): string | null {
  const match = /^\/api\/group\/matches\/([^/]+)\/rounds\/start\/?$/.exec(new URL(request.url).pathname)
  try { return match ? decodeURIComponent(match[1]!) : null } catch { return null }
}

export function createStartGroupRoundHandler(start = beginGroupRound) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return Response.json({ error: { code: 'invalid_request' } }, { status: 405, headers: { ...headers, Allow: 'POST' } })
    try {
      const result = await start(validateGroupPlayCommand(
        groupId(request),
        request.headers.get('authorization'),
        request.headers.get('idempotency-key'),
      ))
      return Response.json(result, { status: 200, headers })
    } catch (error: unknown) {
      if (error instanceof GroupPlayError) {
        return Response.json(
          { error: { code: error.code === 'CANNOT_START' ? 'cannot_start' : 'play_unavailable' } },
          { status: error.code === 'CANNOT_START' ? 409 : 404, headers },
        )
      }
      return Response.json({ error: { code: 'internal_error' } }, { status: 500, headers })
    }
  }
}

export default { fetch: createStartGroupRoundHandler() }
