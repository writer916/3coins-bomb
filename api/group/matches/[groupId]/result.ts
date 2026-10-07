import { GetGroupResultError, getGroupResult, validateGetGroupResultRequest } from '../../../../server/group/getResult.js'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
function groupId(request: Request): string | null {
  const match = /^\/api\/group\/matches\/([^/]+)\/result\/?$/.exec(new URL(request.url).pathname)
  try { return match ? decodeURIComponent(match[1]!) : null } catch { return null }
}
export function createGetGroupResultHandler(read = getGroupResult) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ error: { code: 'invalid_request' } }, { status: 405, headers: { ...headers, Allow: 'GET' } })
    try {
      return Response.json(await read(validateGetGroupResultRequest(groupId(request), request.headers.get('authorization'))), { status: 200, headers })
    } catch (error) {
      const unavailable = error instanceof GetGroupResultError
      return Response.json({ error: { code: unavailable ? 'group_result_unavailable' : 'internal_error' } }, { status: unavailable ? 404 : 500, headers })
    }
  }
}
export default { fetch: createGetGroupResultHandler() }
