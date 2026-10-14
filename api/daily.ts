import getParticipant from './_daily/challenges/[date]/participant.js'
import joinParticipant from './_daily/challenges/current/participants.js'

type FetchHandler = {
  readonly fetch: (request: Request) => Promise<Response>
}

function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
}

function requestPathname(request: Request): string {
  const url = new URL(request.url)
  const pathname = normalizePathname(url.pathname)
  if (pathname !== '/api/daily') return pathname
  const rewritten = url.searchParams.get('path')
  if (!rewritten) return pathname
  return normalizePathname(
    `/api/daily/${rewritten.split('/').map(decodeURIComponent).join('/')}`,
  )
}

function resolveHandler(pathname: string): FetchHandler | null {
  if (pathname === '/api/daily/challenges/current/participants') {
    return joinParticipant
  }
  if (/^\/api\/daily\/challenges\/[^/]+\/participant$/.test(pathname)) {
    return getParticipant
  }
  return null
}

function withEffectivePathname(request: Request, pathname: string): Request {
  const url = new URL(request.url)
  if (normalizePathname(url.pathname) === pathname) return request
  const next = new URL(request.url)
  next.pathname = pathname
  next.searchParams.delete('path')
  return new Request(next, request)
}

export default {
  async fetch(request: Request): Promise<Response> {
    const pathname = requestPathname(request)
    const handler = resolveHandler(pathname)
    if (!handler) {
      return Response.json(
        { error: { code: 'not_found' } },
        { status: 404, headers: { ...JSON_HEADERS } },
      )
    }
    return handler.fetch(withEffectivePathname(request, pathname))
  },
}

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}
