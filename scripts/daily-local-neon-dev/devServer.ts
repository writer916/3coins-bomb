/**
 * Same-origin local:dev for DAILY on Neon:dev only.
 * Loads .env.neon.dev.local + .env.neon.dev.hmac.local — never .env.local.
 *
 * Do not start this from the engineering "guard-only" phase without approval.
 */
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import {
  LOCAL_NEON_DEV_ENV_FLAG,
  assertAllowedLocalNeonDevDatabaseUrl,
  isLocalNeonDevGuardEnabled,
} from '../../server/db/localNeonDevGuard.ts'
import { loadDailyLocalNeonDevEnv } from './loadEnv.ts'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const DEFAULT_PORT = 5173

type FetchHandler = { readonly fetch: (request: Request) => Promise<Response> }

async function toWebRequest(
  req: IncomingMessage,
  origin: string,
): Promise<Request> {
  const url = new URL(req.url ?? '/', origin)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry)
    } else {
      headers.set(key, value)
    }
  }
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return new Request(url, {
    method,
    headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  })
}

async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

function resolveApiHandler(
  pathname: string,
  daily: FetchHandler,
  duel: FetchHandler,
  group: FetchHandler,
): FetchHandler | null {
  if (pathname === '/api/daily' || pathname.startsWith('/api/daily/')) {
    return daily
  }
  if (pathname === '/api/duel' || pathname.startsWith('/api/duel/')) {
    return duel
  }
  if (pathname === '/api/group' || pathname.startsWith('/api/group/')) {
    return group
  }
  return null
}

async function main(): Promise<void> {
  const loaded = loadDailyLocalNeonDevEnv(repoRoot)
  if (!loaded.ok) {
    console.error(`[daily-local-neon-dev] ${loaded.reason}`)
    if (loaded.hostClass) {
      console.error(`[daily-local-neon-dev] hostClass=${loaded.hostClass}`)
    }
    process.exitCode = 1
    return
  }

  if (!isLocalNeonDevGuardEnabled() || process.env[LOCAL_NEON_DEV_ENV_FLAG] !== '1') {
    console.error('[daily-local-neon-dev] LOCAL Neon:dev guard flag is not active.')
    process.exitCode = 1
    return
  }

  // Final gate before importing DB-backed API modules.
  assertAllowedLocalNeonDevDatabaseUrl(process.env.DATABASE_URL)

  const [{ default: daily }, { default: duel }, { default: group }] =
    await Promise.all([
      import('../../api/daily.ts'),
      import('../../api/duel.ts'),
      import('../../api/group.ts'),
    ])

  // Re-check after imports in case any module mutated env (should not).
  assertAllowedLocalNeonDevDatabaseUrl(process.env.DATABASE_URL)

  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error('[daily-local-neon-dev] Invalid PORT.')
    process.exitCode = 1
    return
  }

  const vite = await createViteServer({
    root: repoRoot,
    server: { middlewareMode: true },
    appType: 'spa',
  })

  const origin = `http://127.0.0.1:${port}`
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        // Every API request: refuse if DATABASE_URL was overwritten mid-process.
        assertAllowedLocalNeonDevDatabaseUrl(process.env.DATABASE_URL)

        const pathname = new URL(req.url ?? '/', origin).pathname
        const api = resolveApiHandler(pathname, daily, duel, group)
        if (api) {
          const request = await toWebRequest(req, origin)
          const response = await api.fetch(request)
          await writeWebResponse(res, response)
          return
        }

        vite.middlewares(req, res, () => {
          res.statusCode = 404
          res.end('Not found')
        })
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Local Neon:dev request failed.'
        // Never include connection strings.
        if (!res.headersSent) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { code: 'service_unavailable' } }))
        }
        console.error(`[daily-local-neon-dev] ${message}`)
      }
    })()
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[daily-local-neon-dev] guard=ON hostClass=${loaded.hostClass}`)
    console.log(`[daily-local-neon-dev] listening ${origin}/`)
    console.log('[daily-local-neon-dev] Open DAILY from the top screen (no /daily path).')
    console.log('[daily-local-neon-dev] Stop with Ctrl+C.')
  })
}

await main()
