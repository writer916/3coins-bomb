import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL?.trim()

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
})
