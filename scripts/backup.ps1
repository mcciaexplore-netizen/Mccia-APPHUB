# Dumps the public schema of DATABASE_URL to backups\mccia-hub-<timestamp>.sql
# Full dump (schema + data) by default. Use -DataOnly when the target already has the
# migrations applied (the Neon -> own server move).
# Usage: $env:DATABASE_URL="postgres://..."; .\scripts\backup.ps1 [-DataOnly]
param([switch]$DataOnly)
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL first." }
New-Item -ItemType Directory -Force -Path backups | Out-Null
$file = "backups\mccia-hub-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
$args = @("--dbname=$env:DATABASE_URL", "--schema=public", "--no-owner", "--no-privileges", "--format=plain", "--file=$file")
if ($DataOnly) { $args += @("--data-only", "--disable-triggers") }
pg_dump @args
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Write-Host "Backup written to $file"
