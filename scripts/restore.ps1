# Restores a plain .sql dump into the database in DATABASE_URL (the TARGET).
# Usage: $env:DATABASE_URL="postgres://target..."; .\scripts\restore.ps1 -File backups\x.sql
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the TARGET database first." }
if (-not (Test-Path $File)) { throw "File not found: $File" }
psql --dbname="$env:DATABASE_URL" --set ON_ERROR_STOP=1 --file=$File
if ($LASTEXITCODE -ne 0) { throw "psql restore failed" }
Write-Host "Restore complete from $File"
