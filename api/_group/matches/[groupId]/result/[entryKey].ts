import {
  GetGroupResultDetailError,
  getGroupResultDetail,
  validateGetGroupResultDetailRequest,
} from '../../../../../server/group/getResultDetail.js'

const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function pathParts(request: Request): { groupId: string; entryKey: string } | null {
  const match = /^\/api\/group\/matches\/([^/]+)\/result\/([^/]+)\/?$/.exec(
    new URL(request.url).pathname,
  )
  if (!match) return null
  try {
    return {
      groupId: decodeURIComponent(match[1]!),
      entryKey: decodeURIComponent(match[2]!),
    }
  } catch {
    return null
  }
}

export function createGetGroupResultDetailHandler(read = getGroupResultDetail) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') {
      return Response.json(
        { error: { code: 'invalid_request' } },
        { status: 405, headers: { ...headers, Allow: 'GET' } },
      )
    }
    const parts = pathParts(request)
    if (!parts) {
      return Response.json(
        { error: { code: 'group_result_detail_unavailable' } },
        { status: 404, headers },
      )
    }
    try {
      const view = await read(
        validateGetGroupResultDetailRequest(
          parts.groupId,
          parts.entryKey,
          request.headers.get('authorization'),
        ),
      )
      return Response.json(view, { status: 200, headers })
    } catch (error) {
      const unavailable = error instanceof GetGroupResultDetailError
      return Response.json(
        { error: { code: unavailable ? 'group_result_detail_unavailable' : 'internal_error' } },
        { status: unavailable ? 404 : 500, headers },
      )
    }
  }
}

export default { fetch: createGetGroupResultDetailHandler() }
