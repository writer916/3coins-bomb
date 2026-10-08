import createMatches from './_group/matches.js'
import cashOut from './_group/matches/[groupId]/cash-out.js'
import closeMatch from './_group/matches/[groupId]/close.js'
import joinParticipant from './_group/matches/[groupId]/join.js'
import openBag from './_group/matches/[groupId]/open.js'
import getPlacements from './_group/matches/[groupId]/placements.js'
import getPlayState from './_group/matches/[groupId]/play.js'
import resumePlay from './_group/matches/[groupId]/play/resume.js'
import getProgress from './_group/matches/[groupId]/progress.js'
import getResult from './_group/matches/[groupId]/result.js'
import getResultDetail from './_group/matches/[groupId]/result/[entryKey].js'
import startRound from './_group/matches/[groupId]/rounds/start.js'

type FetchHandler = {
  readonly fetch: (request: Request) => Promise<Response>
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/** Prefer the original request path; fall back to rewrite `path` query. */
function requestPathname(request: Request): string {
  const url = new URL(request.url)
  const pathname = normalizePathname(url.pathname)
  if (pathname !== '/api/group') return pathname
  const rewritten = url.searchParams.get('path')
  if (!rewritten) return pathname
  return normalizePathname(`/api/group/${rewritten.split('/').map(decodeURIComponent).join('/')}`)
}

function resolveHandler(pathname: string): FetchHandler | null {
  const path = normalizePathname(pathname)
  if (path === '/api/group/matches') return createMatches
  if (/^\/api\/group\/matches\/[^/]+\/join$/.test(path)) return joinParticipant
  if (/^\/api\/group\/matches\/[^/]+\/cash-out$/.test(path)) return cashOut
  if (/^\/api\/group\/matches\/[^/]+\/close$/.test(path)) return closeMatch
  if (/^\/api\/group\/matches\/[^/]+\/open$/.test(path)) return openBag
  if (/^\/api\/group\/matches\/[^/]+\/placements$/.test(path)) return getPlacements
  if (/^\/api\/group\/matches\/[^/]+\/play\/resume$/.test(path)) return resumePlay
  if (/^\/api\/group\/matches\/[^/]+\/play$/.test(path)) return getPlayState
  if (/^\/api\/group\/matches\/[^/]+\/progress$/.test(path)) return getProgress
  if (/^\/api\/group\/matches\/[^/]+\/result\/[^/]+$/.test(path)) {
    return getResultDetail
  }
  if (/^\/api\/group\/matches\/[^/]+\/result$/.test(path)) return getResult
  if (/^\/api\/group\/matches\/[^/]+\/rounds\/start$/.test(path)) return startRound
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
        {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
      )
    }
    return handler.fetch(withEffectivePathname(request, pathname))
  },
}
