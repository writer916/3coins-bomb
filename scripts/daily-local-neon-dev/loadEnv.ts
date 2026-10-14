/**
 * Loads ONLY Neon:dev local files for DAILY PC playtesting.
 * Never reads production-oriented local env pull files.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LOCAL_NEON_DEV_ENV_FLAG,
  assertAllowedLocalNeonDevDatabaseUrl,
  classifyDatabaseUrlHost,
} from '../../server/db/localNeonDevGuard.ts'
import { readDuelTokenHmacKey } from '../../server/auth/duelTokens.ts'

export const NEON_DEV_DATABASE_ENV_FILE = '.env.neon.dev.local' as const
export const NEON_DEV_HMAC_ENV_FILE = '.env.neon.dev.hmac.local' as const

export type LocalNeonDevEnvLoadResult =
  | {
      readonly ok: true
      readonly hostClass: 'neon_dev_allowed'
      readonly hasHmacKey: true
    }
  | {
      readonly ok: false
      readonly reason: string
      readonly hostClass?: string
    }

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function readEnvFile(repoRoot: string, fileName: string): string | null {
  try {
    return readFileSync(resolve(repoRoot, fileName), 'utf8')
  } catch {
    return null
  }
}

/**
 * Applies Neon:dev DATABASE_URL + local HMAC into process.env and enables the guard.
 * Does not print secrets. Returns a structured result for CLI exit codes.
 */
export function loadDailyLocalNeonDevEnv(repoRoot: string): LocalNeonDevEnvLoadResult {
  const databaseRaw = readEnvFile(repoRoot, NEON_DEV_DATABASE_ENV_FILE)
  if (databaseRaw === null) {
    return {
      ok: false,
      reason: `Missing ${NEON_DEV_DATABASE_ENV_FILE} (read-only Neon:dev DATABASE_URL file).`,
    }
  }
  const databaseMap = parseEnvFile(databaseRaw)
  const databaseUrl = databaseMap.DATABASE_URL?.trim()
  const hostClass = classifyDatabaseUrlHost(databaseUrl)
  if (hostClass !== 'neon_dev_allowed') {
    return {
      ok: false,
      reason: `DATABASE_URL from ${NEON_DEV_DATABASE_ENV_FILE} is not the known Neon:dev host.`,
      hostClass,
    }
  }

  const hmacRaw = readEnvFile(repoRoot, NEON_DEV_HMAC_ENV_FILE)
  if (hmacRaw === null) {
    return {
      ok: false,
      reason: `Missing ${NEON_DEV_HMAC_ENV_FILE}. Copy scripts/daily-local-neon-dev-hmac.example and generate a local-only key.`,
      hostClass,
    }
  }
  const hmacMap = parseEnvFile(hmacRaw)
  const hmacKey = hmacMap.DUEL_TOKEN_HMAC_KEY?.trim()
  if (!hmacKey) {
    return {
      ok: false,
      reason: `${NEON_DEV_HMAC_ENV_FILE} must define DUEL_TOKEN_HMAC_KEY.`,
      hostClass,
    }
  }

  // Enable guard BEFORE assigning DATABASE_URL so any subsequent access is checked.
  process.env[LOCAL_NEON_DEV_ENV_FLAG] = '1'
  try {
    assertAllowedLocalNeonDevDatabaseUrl(databaseUrl)
    process.env.DATABASE_URL = databaseUrl!
    process.env.DUEL_TOKEN_HMAC_KEY = hmacKey
    // Validate key shape without echoing it.
    readDuelTokenHmacKey(process.env)
  } catch (error: unknown) {
    delete process.env.DATABASE_URL
    delete process.env.DUEL_TOKEN_HMAC_KEY
    delete process.env[LOCAL_NEON_DEV_ENV_FLAG]
    const message =
      error instanceof Error ? error.message : 'Local Neon:dev env validation failed.'
    return { ok: false, reason: message, hostClass }
  }

  // Re-assert: whatever is now in process.env must still be allowlisted.
  try {
    assertAllowedLocalNeonDevDatabaseUrl(process.env.DATABASE_URL)
  } catch (error: unknown) {
    delete process.env.DATABASE_URL
    delete process.env.DUEL_TOKEN_HMAC_KEY
    delete process.env[LOCAL_NEON_DEV_ENV_FLAG]
    const message =
      error instanceof Error ? error.message : 'Post-assign DATABASE_URL check failed.'
    return { ok: false, reason: message, hostClass: 'unknown_refused' }
  }

  return { ok: true, hostClass: 'neon_dev_allowed', hasHmacKey: true }
}
