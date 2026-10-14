import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import {
  applyLocalNeonDevDatabaseUrlPolicy,
  databaseUrlHostFingerprint,
  isLocalNeonDevGuardEnabled,
} from './localNeonDevGuard.js'
import * as schema from './schema.js'

function readDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required for server-side database access. Configure it in the server environment.',
    )
  }
  // LOCAL Neon:dev mode only: allowlist check. Production leaves the flag unset.
  return applyLocalNeonDevDatabaseUrlPolicy(databaseUrl)
}

function createDatabase(databaseUrl: string) {
  const queryClient = neon(databaseUrl)
  return drizzle(queryClient, { schema })
}

export type Database = ReturnType<typeof createDatabase>

let database: Database | undefined
let databaseHostFingerprint: string | null | undefined

/**
 * Lazily creates the server-only Drizzle client; importing this module does not connect.
 * In LOCAL Neon:dev mode, re-validates DATABASE_URL on every call so a later env
 * overwrite (e.g. tooling injecting production) cannot keep a prior client.
 */
export function getDatabase(): Database {
  const databaseUrl = readDatabaseUrl()
  if (isLocalNeonDevGuardEnabled()) {
    const fingerprint = databaseUrlHostFingerprint(databaseUrl)
    if (database && databaseHostFingerprint !== fingerprint) {
      database = undefined
    }
    databaseHostFingerprint = fingerprint
  }
  database ??= createDatabase(databaseUrl)
  return database
}
