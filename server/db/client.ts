import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

function readDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required for server-side database access. Configure it in the server environment.',
    )
  }
  return databaseUrl
}

function createDatabase() {
  const queryClient = neon(readDatabaseUrl())
  return drizzle(queryClient, { schema })
}

export type Database = ReturnType<typeof createDatabase>

let database: Database | undefined

/** Lazily creates the server-only Drizzle client; importing this module does not connect. */
export function getDatabase(): Database {
  database ??= createDatabase()
  return database
}
