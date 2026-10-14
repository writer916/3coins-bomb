/**
 * Validates Neon:dev env files and applies them into process.env.
 * Prints host classification only — never secrets. No DB connection.
 */
import { resolve } from 'node:path'
import { loadDailyLocalNeonDevEnv } from './daily-local-neon-dev/loadEnv.ts'

const root = resolve(import.meta.dirname, '..')
const result = loadDailyLocalNeonDevEnv(root)
if (!result.ok) {
  console.error(`[assert-daily-local-neon-dev-env] FAIL: ${result.reason}`)
  if (result.hostClass) {
    console.error(`[assert-daily-local-neon-dev-env] hostClass=${result.hostClass}`)
  }
  process.exitCode = 1
} else {
  console.log(
    `[assert-daily-local-neon-dev-env] OK hostClass=${result.hostClass} hmac=present guard=ON`,
  )
}
