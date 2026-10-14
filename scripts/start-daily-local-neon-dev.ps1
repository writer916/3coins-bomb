# DAILY local play on Neon:dev only (same-origin Vite + API).
# Does NOT read .env.local or .vercel/.env.development.local.
# Does NOT use `vercel:dev` (that path can inject production DATABASE_URL).
#
# Usage (next engineering phase — do not start until HMAC file exists and approved):
#   powershell -ExecutionPolicy Bypass -File scripts\start-daily-local-neon-dev.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

Write-Host '=== Git pretest ==='
git rev-parse HEAD
git status --short
git rev-list --left-right --count origin/main...HEAD

Write-Host '=== Guard unit check (no DB) ==='
npx --no-install tsx scripts/verify-local-neon-dev-guard.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '=== Neon:dev env assert (no DB connect) ==='
npx --no-install tsx scripts/assert-daily-local-neon-dev-env.ts
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Create repo-root .env.neon.dev.hmac.local from scripts/daily-local-neon-dev-hmac.example'
  Write-Host 'Generate key: node -e "console.log(require(''crypto'').randomBytes(32).toString(''base64url''))"'
  Write-Host 'Do not copy the production HMAC key.'
  exit $LASTEXITCODE
}

Write-Host '=== Starting same-origin local:dev (127.0.0.1) ==='
Write-Host 'Browser URL: http://127.0.0.1:5173/'
Write-Host 'Open DAILY from the top screen. Stop with Ctrl+C.'
npx --no-install tsx scripts/daily-local-neon-dev/devServer.ts
exit $LASTEXITCODE
