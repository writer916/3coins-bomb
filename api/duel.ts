import createMatches from './_duel/matches.js'
import getMatch from './_duel/matches/[matchId].js'
import claimParticipant from './_duel/matches/[matchId]/claim.js'
import getDetail from './_duel/matches/[matchId]/detail.js'
import getOpponentPlacements from './_duel/matches/[matchId]/opponent-placements.js'
import lockPlacements from './_duel/matches/[matchId]/placements/lock.js'
import getPlayState from './_duel/matches/[matchId]/play.js'
import getResult from './_duel/matches/[matchId]/result.js'
import cashOutRound from './_duel/matches/[matchId]/rounds/[roundNumber]/cash-out.js'
import openBag from './_duel/matches/[matchId]/rounds/[roundNumber]/open.js'
import getRoundReveal from './_duel/matches/[matchId]/rounds/[roundNumber]/reveal.js'

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
  if (pathname !== '/api/duel') return pathname
  const rewritten = url.searchParams.get('path')
  if (!rewritten) return pathname
  return normalizePathname(`/api/duel/${rewritten.split('/').map(decodeURIComponent).join('/')}`)
}

function resolveHandler(pathname: string): FetchHandler | null {
  const path = normalizePathname(pathname)
  if (path === '/api/duel/matches') return createMatches
  if (/^\/api\/duel\/matches\/[^/]+$/.test(path)) return getMatch
  if (/^\/api\/duel\/matches\/[^/]+\/claim$/.test(path)) return claimParticipant
  if (/^\/api\/duel\/matches\/[^/]+\/detail$/.test(path)) return getDetail
  if (/^\/api\/duel\/matches\/[^/]+\/opponent-placements$/.test(path)) {
    return getOpponentPlacements
  }
  if (/^\/api\/duel\/matches\/[^/]+\/placements\/lock$/.test(path)) {
    return lockPlacements
  }
  if (/^\/api\/duel\/matches\/[^/]+\/play$/.test(path)) return getPlayState
  if (/^\/api\/duel\/matches\/[^/]+\/result$/.test(path)) return getResult
  if (/^\/api\/duel\/matches\/[^/]+\/rounds\/[^/]+\/cash-out$/.test(path)) {
    return cashOutRound
  }
  if (/^\/api\/duel\/matches\/[^/]+\/rounds\/[^/]+\/open$/.test(path)) {
    return openBag
  }
  if (/^\/api\/duel\/matches\/[^/]+\/rounds\/[^/]+\/reveal$/.test(path)) {
    return getRoundReveal
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
