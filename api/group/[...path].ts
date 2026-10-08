import createMatches from '../_group/matches.js'
import cashOut from '../_group/matches/[groupId]/cash-out.js'
import closeMatch from '../_group/matches/[groupId]/close.js'
import joinParticipant from '../_group/matches/[groupId]/join.js'
import openBag from '../_group/matches/[groupId]/open.js'
import getPlacements from '../_group/matches/[groupId]/placements.js'
import getPlayState from '../_group/matches/[groupId]/play.js'
import resumePlay from '../_group/matches/[groupId]/play/resume.js'
import getProgress from '../_group/matches/[groupId]/progress.js'
import getResult from '../_group/matches/[groupId]/result.js'
import getResultDetail from '../_group/matches/[groupId]/result/[entryKey].js'
import startRound from '../_group/matches/[groupId]/rounds/start.js'

type FetchHandler = {
  readonly fetch: (request: Request) => Promise<Response>
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
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

export default {
  async fetch(request: Request): Promise<Response> {
    const handler = resolveHandler(new URL(request.url).pathname)
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
    return handler.fetch(request)
  },
}
