param([string]$Suffix = ([guid]::NewGuid().ToString("N").Substring(0, 10)))

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$container = "lumina-crm-rls-it-$Suffix"
if ($container -notmatch '^lumina-crm-rls-it-[a-f0-9]{10}$') { throw "Invalid isolated test name" }
$evidenceRoot = Join-Path $repositoryRoot "work\staff-invitation-rls"
$stagePath = Join-Path $evidenceRoot "$Suffix.stage"
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
function Write-Stage([string]$Stage) { [IO.File]::AppendAllText($stagePath, "$Stage`n") }

function New-TestSecret { ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")) }
$postgresPassword = New-TestSecret
$appPassword = New-TestSecret
$systemPassword = New-TestSecret
$workerPassword = New-TestSecret
$migratorPassword = New-TestSecret
$backupPassword = New-TestSecret

try {
  if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Force }
  Write-Stage "STARTED"
  docker run --detach --rm --name $container `
    --label com.lumina.crm.test=staff-invitation-rls `
    --publish 127.0.0.1::5432 `
    --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=512m `
    --env POSTGRES_DB=lumina_crm --env POSTGRES_USER=postgres `
    --env POSTGRES_PASSWORD=$postgresPassword postgres:18.4-bookworm | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Isolated PostgreSQL startup failed" }
  $healthy = $false
  foreach ($attempt in 1..45) {
    docker exec --env PGPASSWORD=$postgresPassword $container `
      pg_isready --quiet --host 127.0.0.1 --username postgres --dbname lumina_crm
    if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
    Start-Sleep -Seconds 1
  }
  if (!$healthy) { throw "Isolated PostgreSQL did not become ready" }
  Write-Stage "READY"

  $hostPort = (docker port $container 5432/tcp).Split(":")[-1].Trim()
  if ($hostPort -notmatch '^\d{4,5}$') { throw "Isolated PostgreSQL loopback port was not resolved" }
  $adminUrl = "postgresql://postgres:$postgresPassword@127.0.0.1:$hostPort/lumina_crm"
  $env:NODE_ENV = "test"
  $env:DATABASE_ADMIN_URL = $adminUrl
  $env:CRM_APP_DB_PASSWORD = $appPassword
  $env:CRM_SYSTEM_DB_PASSWORD = $systemPassword
  $env:CRM_WORKER_DB_PASSWORD = $workerPassword
  $env:CRM_MIGRATOR_DB_PASSWORD = $migratorPassword
  $env:CRM_BACKUP_DB_PASSWORD = $backupPassword
  node (Join-Path $repositoryRoot "scripts\db-bootstrap.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Database bootstrap failed" }
  Write-Stage "BOOTSTRAPPED"

  $env:MIGRATION_DATABASE_URL = "postgresql://crm_migrator:$migratorPassword@127.0.0.1:$hostPort/lumina_crm"
  node (Join-Path $repositoryRoot "scripts\db-migrate.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed" }
  Write-Stage "MIGRATED"

  node (Join-Path $repositoryRoot "scripts\test-staff-invitation-rls.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Staff invitation RLS behavior test failed" }
  Write-Stage "ASSERTED"
} finally {
  $existing = docker ps --all --filter "name=^/${container}$" --format "{{.Names}}"
  if ($existing -eq $container) { docker rm --force $container | Out-Null }
  foreach ($name in @("NODE_ENV","DATABASE_ADMIN_URL","MIGRATION_DATABASE_URL","CRM_APP_DB_PASSWORD","CRM_SYSTEM_DB_PASSWORD","CRM_WORKER_DB_PASSWORD","CRM_MIGRATOR_DB_PASSWORD","CRM_BACKUP_DB_PASSWORD")) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
  Write-Stage "CLEANED"
}
