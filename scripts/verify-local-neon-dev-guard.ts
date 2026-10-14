/**
 * Static / in-process tests for LOCAL Neon:dev allowlist (no DB, no server).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ALLOWED_NEON_DEV_ENDPOINT_ID,
  LOCAL_NEON_DEV_ENV_FLAG,
  LocalNeonDevDatabaseUrlError,
  REFUSED_PRODUCTION_NEON_MARKER,
  applyLocalNeonDevDatabaseUrlPolicy,
  assertAllowedLocalNeonDevDatabaseUrl,
  classifyDatabaseUrlHost,
  databaseUrlHostFingerprint,
  isLocalNeonDevGuardEnabled,
} from '../server/db/localNeonDevGuard.ts'

const root = resolve(import.meta.dirname, '..')

const neonDevUrl = `postgresql://u:p@${ALLOWED_NEON_DEV_ENDPOINT_ID}.aws.neon.tech/neondb`
const productionUrl = `postgresql://u:p@${REFUSED_PRODUCTION_NEON_MARKER}.aws.neon.tech/neondb`
const unknownUrl = 'postgresql://u:p@ep-other-endpoint.aws.neon.tech/neondb'
const smuggleUrl = `postgresql://${ALLOWED_NEON_DEV_ENDPOINT_ID}:x@evil.example/db`

assert.equal(classifyDatabaseUrlHost(null), 'missing')
assert.equal(classifyDatabaseUrlHost(''), 'missing')
assert.equal(classifyDatabaseUrlHost('   '), 'missing')
assert.equal(classifyDatabaseUrlHost('not-a-url'), 'invalid')
assert.equal(classifyDatabaseUrlHost(productionUrl), 'production_refused')
assert.equal(classifyDatabaseUrlHost(unknownUrl), 'unknown_refused')
assert.equal(classifyDatabaseUrlHost(smuggleUrl), 'unknown_refused')
assert.equal(classifyDatabaseUrlHost(neonDevUrl), 'neon_dev_allowed')
assert.equal(
  classifyDatabaseUrlHost(
    `postgres://u:p@${ALLOWED_NEON_DEV_ENDPOINT_ID}.eu-central-1.aws.neon.tech/db`,
  ),
  'neon_dev_allowed',
)
// Bare endpoint id without neon.tech is refused.
assert.equal(
  classifyDatabaseUrlHost(`postgresql://u:p@${ALLOWED_NEON_DEV_ENDPOINT_ID}/db`),
  'unknown_refused',
)

assert.equal(assertAllowedLocalNeonDevDatabaseUrl(neonDevUrl), neonDevUrl)
assert.throws(
  () => assertAllowedLocalNeonDevDatabaseUrl(productionUrl),
  (error: unknown) =>
    error instanceof LocalNeonDevDatabaseUrlError &&
    error.code === 'production_refused' &&
    !error.message.includes('postgresql://'),
)
assert.throws(
  () => assertAllowedLocalNeonDevDatabaseUrl(unknownUrl),
  (error: unknown) =>
    error instanceof LocalNeonDevDatabaseUrlError &&
    error.code === 'unknown_refused',
)
assert.throws(
  () => assertAllowedLocalNeonDevDatabaseUrl(undefined),
  (error: unknown) =>
    error instanceof LocalNeonDevDatabaseUrlError && error.code === 'missing',
)
assert.throws(
  () => assertAllowedLocalNeonDevDatabaseUrl('::::'),
  (error: unknown) =>
    error instanceof LocalNeonDevDatabaseUrlError && error.code === 'invalid',
)

const envOff: NodeJS.ProcessEnv = { ...process.env }
delete envOff[LOCAL_NEON_DEV_ENV_FLAG]
assert.equal(isLocalNeonDevGuardEnabled(envOff), false)
assert.equal(
  applyLocalNeonDevDatabaseUrlPolicy(productionUrl, envOff),
  productionUrl,
  'Production must not be blocked when LOCAL flag is unset',
)

const envOn: NodeJS.ProcessEnv = {
  ...process.env,
  [LOCAL_NEON_DEV_ENV_FLAG]: '1',
}
assert.equal(isLocalNeonDevGuardEnabled(envOn), true)
assert.equal(applyLocalNeonDevDatabaseUrlPolicy(neonDevUrl, envOn), neonDevUrl)
assert.throws(
  () => applyLocalNeonDevDatabaseUrlPolicy(productionUrl, envOn),
  LocalNeonDevDatabaseUrlError,
)

assert.equal(
  databaseUrlHostFingerprint(neonDevUrl),
  `${ALLOWED_NEON_DEV_ENDPOINT_ID}.aws.neon.tech`,
)

const clientSource = readFileSync(resolve(root, 'server/db/client.ts'), 'utf8')
assert.match(clientSource, /applyLocalNeonDevDatabaseUrlPolicy/)
assert.match(clientSource, /isLocalNeonDevGuardEnabled/)
assert.match(clientSource, /databaseUrlHostFingerprint/)

const loadEnvSource = readFileSync(
  resolve(root, 'scripts/daily-local-neon-dev/loadEnv.ts'),
  'utf8',
)
assert.match(loadEnvSource, /NEON_DEV_DATABASE_ENV_FILE/)
assert.match(loadEnvSource, /NEON_DEV_HMAC_ENV_FILE/)
assert.match(loadEnvSource, /\.env\.neon\.dev\.local/)
assert.match(loadEnvSource, /\.env\.neon\.dev\.hmac\.local/)
assert.equal(
  (loadEnvSource.match(/readEnvFile\(repoRoot,/g) ?? []).length,
  2,
  'loader must only read the two Neon:dev files via readEnvFile',
)
assert.doesNotMatch(loadEnvSource, /['"]\.env\.local['"]/)
assert.doesNotMatch(loadEnvSource, /env\.development\.local/)

const devServerText = readFileSync(
  resolve(root, 'scripts/daily-local-neon-dev/devServer.ts'),
  'utf8',
)
assert.match(devServerText, /loadDailyLocalNeonDevEnv/)
assert.match(devServerText, /assertAllowedLocalNeonDevDatabaseUrl/)
assert.doesNotMatch(devServerText, /vercel\s+dev/)

// Shared client change must remain opt-in; SOLO/DUEL/GROUP entrypoints untouched.
for (const relative of [
  'api/duel.ts',
  'api/group.ts',
  'api/daily.ts',
  'src/App.tsx',
]) {
  const source = readFileSync(resolve(root, relative), 'utf8')
  assert.doesNotMatch(source, /LOCAL_NEON_DEV_ENV_FLAG/)
  assert.doesNotMatch(source, /THREE_COINS_LOCAL_NEON_DEV/)
}

console.log('verify:local-neon-dev-guard OK')
