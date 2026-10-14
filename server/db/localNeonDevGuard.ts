/**
 * Explicit local Neon-dev allowlist for DAILY PC playtesting.
 *
 * Active only when THREE_COINS_LOCAL_NEON_DEV=1.
 * Production and normal deploys leave that flag unset and are unchanged.
 *
 * Never log connection strings, passwords, or secrets.
 */

export const LOCAL_NEON_DEV_ENV_FLAG = 'THREE_COINS_LOCAL_NEON_DEV' as const

/** Known Neon:dev endpoint id (hostname label). Not a secret. */
export const ALLOWED_NEON_DEV_ENDPOINT_ID =
  'ep-still-night-b339xjc9-pooler' as const

/** Production Neon marker used by existing verify scripts. Not a secret. */
export const REFUSED_PRODUCTION_NEON_MARKER = 'ep-ancient-lake' as const

export type DatabaseUrlHostClass =
  | 'missing'
  | 'invalid'
  | 'production_refused'
  | 'neon_dev_allowed'
  | 'unknown_refused'

const NEON_DEV_HOST_PATTERN = new RegExp(
  `^${ALLOWED_NEON_DEV_ENDPOINT_ID.replace(/\./g, '\\.')}(?:\\.[a-z0-9-]+)*\\.neon\\.tech$`,
  'i',
)

export function isLocalNeonDevGuardEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[LOCAL_NEON_DEV_ENV_FLAG]?.trim() === '1'
}

/**
 * Parses a Postgres connection string and classifies the DB host.
 * Userinfo is ignored so a marker cannot be smuggled via username.
 */
export function classifyDatabaseUrlHost(
  databaseUrl: string | null | undefined,
): DatabaseUrlHostClass {
  if (databaseUrl === null || databaseUrl === undefined) return 'missing'
  const trimmed = databaseUrl.trim()
  if (!trimmed) return 'missing'

  let hostname: string
  try {
    // URL accepts postgresql:// and postgres://
    hostname = new URL(trimmed).hostname.trim().toLowerCase()
  } catch {
    return 'invalid'
  }
  if (!hostname) return 'invalid'

  // Classify by hostname only — userinfo cannot smuggle the allowlist marker.
  if (hostname.includes(REFUSED_PRODUCTION_NEON_MARKER)) {
    return 'production_refused'
  }
  if (NEON_DEV_HOST_PATTERN.test(hostname)) {
    return 'neon_dev_allowed'
  }
  return 'unknown_refused'
}

export class LocalNeonDevDatabaseUrlError extends Error {
  readonly code: DatabaseUrlHostClass

  constructor(code: Exclude<DatabaseUrlHostClass, 'neon_dev_allowed'>) {
    super(messageForCode(code))
    this.name = 'LocalNeonDevDatabaseUrlError'
    this.code = code
  }
}

function messageForCode(
  code: Exclude<DatabaseUrlHostClass, 'neon_dev_allowed'>,
): string {
  switch (code) {
    case 'missing':
      return 'LOCAL Neon:dev mode: DATABASE_URL is missing.'
    case 'invalid':
      return 'LOCAL Neon:dev mode: DATABASE_URL is not a valid URL.'
    case 'production_refused':
      return 'LOCAL Neon:dev mode: refusing production Neon database host.'
    case 'unknown_refused':
      return 'LOCAL Neon:dev mode: refusing unknown database host (allowlist only).'
    default: {
      const _exhaustive: never = code
      return _exhaustive
    }
  }
}

/** Throws when URL is not the known Neon:dev host. Never includes the URL. */
export function assertAllowedLocalNeonDevDatabaseUrl(
  databaseUrl: string | null | undefined,
): string {
  const classification = classifyDatabaseUrlHost(databaseUrl)
  if (classification !== 'neon_dev_allowed') {
    throw new LocalNeonDevDatabaseUrlError(classification)
  }
  return databaseUrl!.trim()
}

/**
 * When LOCAL Neon:dev mode is on, only the allowlisted host may proceed.
 * When off, the URL is returned unchanged (Production / normal local).
 */
export function applyLocalNeonDevDatabaseUrlPolicy(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!isLocalNeonDevGuardEnabled(environment)) {
    return databaseUrl
  }
  return assertAllowedLocalNeonDevDatabaseUrl(databaseUrl)
}

/** Hostname-only fingerprint for singleton invalidation (no secrets). */
export function databaseUrlHostFingerprint(
  databaseUrl: string,
): string | null {
  try {
    const hostname = new URL(databaseUrl.trim()).hostname.trim().toLowerCase()
    return hostname || null
  } catch {
    return null
  }
}
