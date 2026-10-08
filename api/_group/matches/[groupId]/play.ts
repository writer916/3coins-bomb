import {
  GroupPlayError,
  readGroupPlayState,
  validateGroupPlayAuth,
} from '../../../../server/group/play.js'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }

function groupId(request: Request): string | null {
  const match = /^\/api\/group\/matches\/([^/]+)\/play\/?$/.exec(new URL(request.url).pathname)
  try { return match ? decodeURIComponent(match[1]!) : null } catch { return null }
}

export function createGroupPlayHandler(read = readGroupPlayState) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: { code: 'invalid_request' } }, { status: 405, headers: { ...headers, Allow: 'GET' } })
    try {
      const result = await read(validateGroupPlayAuth(groupId(request), request.headers.get('authorization')))
      return Response.json(result, { status: 200, headers })
    } catch (error: unknown) {
      return Response.json(
        { error: { code: error instanceof GroupPlayError ? 'play_unavailable' : 'internal_error' } },
        { status: error instanceof GroupPlayError ? 404 : 500, headers },
      )
    }
  }
}

export default { fetch: createGroupPlayHandler() }
