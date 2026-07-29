param(
  [string]$Suffix = ([guid]::NewGuid().ToString("N").Substring(0, 10))
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = "lumina-crm-it-$Suffix"
$backendNetwork = "$project-backend"
$postgresVolume = "$project-postgres-data"
$secretRoot = Join-Path $repositoryRoot "work\$project-secrets"
$composeFile = Join-Path $repositoryRoot "compose.production.yml"
$containerId = $null
$restoreDatabase = $null

foreach ($value in @($project, $backendNetwork, $postgresVolume)) {
  if ($value -notmatch '^lumina-crm-it-[a-f0-9]{10}(?:-(?:backend|postgres-data))?$') {
    throw "Refusing non-isolated integration resource name: $value"
  }
}

function New-TestSecret {
  return ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
}

$superuserPassword = New-TestSecret
$appPassword = New-TestSecret
$systemPassword = New-TestSecret
$workerPassword = New-TestSecret
$migratorPassword = New-TestSecret
$backupPassword = New-TestSecret

try {
  New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $secretRoot "postgres-superuser-password.txt") -Value $superuserPassword -NoNewline
  foreach ($name in @(
    "production.env",
    "worker.env",
    "database-bootstrap.env",
    "migration.env",
    "bootstrap-admin.env",
    "backup.env",
    "restore.env"
  )) {
    Set-Content -LiteralPath (Join-Path $secretRoot $name) -Value "# isolated integration placeholder"
  }

  docker volume create `
    --label com.lumina.crm.managed=true `
    --label com.lumina.crm.repository=kewtgh/crm `
    --label com.docker.compose.project=$project `
    $postgresVolume | Out-Null

  $env:LUMINA_COMPOSE_PROJECT = $project
  $env:LUMINA_BACKEND_NETWORK = $backendNetwork
  $env:LUMINA_POSTGRES_VOLUME = $postgresVolume
  $env:LUMINA_SECRETS_DIR = $secretRoot

  docker compose --file $composeFile up --detach --wait postgres
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL Compose startup failed" }

  $containerId = (docker compose --file $composeFile ps --quiet postgres).Trim()
  if (!$containerId) { throw "PostgreSQL container ID was not resolved" }

  $inspection = docker inspect $containerId | ConvertFrom-Json
  $portBindings = $inspection[0].HostConfig.PortBindings
  if ($null -ne $portBindings -and @($portBindings.PSObject.Properties).Count -gt 0) {
    throw "PostgreSQL unexpectedly has published host ports"
  }
  $attachedNetworks = @($inspection[0].NetworkSettings.Networks.PSObject.Properties.Name)
  if ($attachedNetworks.Count -ne 1 -or $attachedNetworks[0] -ne $backendNetwork) {
    throw "PostgreSQL network isolation failed: $($attachedNetworks -join ',')"
  }

  $adminUrl = "postgresql://postgres:$superuserPassword@postgres:5432/lumina_crm"
  docker run --rm --network $backendNetwork `
    --volume "${repositoryRoot}:/workspace:ro" --workdir /workspace `
    --env NODE_ENV=test `
    --env DATABASE_ADMIN_URL=$adminUrl `
    --env CRM_APP_DB_PASSWORD=$appPassword `
    --env CRM_SYSTEM_DB_PASSWORD=$systemPassword `
    --env CRM_WORKER_DB_PASSWORD=$workerPassword `
    --env CRM_MIGRATOR_DB_PASSWORD=$migratorPassword `
    --env CRM_BACKUP_DB_PASSWORD=$backupPassword `
    node:24.18.0-bookworm-slim node scripts/db-bootstrap.mjs
  if ($LASTEXITCODE -ne 0) { throw "Database bootstrap failed" }

  docker run --rm --network $backendNetwork `
    --volume "${repositoryRoot}:/workspace:ro" --workdir /workspace `
    --env MIGRATION_DATABASE_URL="postgresql://crm_migrator:$migratorPassword@postgres:5432/lumina_crm" `
    node:24.18.0-bookworm-slim node scripts/db-migrate.mjs
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed" }

  $migrationCount = (docker exec --env PGPASSWORD=$superuserPassword $containerId `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) from app_meta.schema_migrations").Trim()
  $expectedMigrationCount = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "db\migrations") -Filter "*.sql").Count
  if ([int]$migrationCount -ne $expectedMigrationCount) {
    throw "Expected $expectedMigrationCount applied migrations, found $migrationCount"
  }

  $backupRole = (docker exec --env PGPASSWORD=$superuserPassword $containerId `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select rolsuper::int || ':' || rolcreatedb::int || ':' || rolcreaterole::int || ':' || rolcanlogin::int from pg_roles where rolname='crm_backup'").Trim()
  if ($backupRole -ne "0:0:0:1") {
    throw "crm_backup role boundary is invalid"
  }
  docker exec --env PGPASSWORD=$backupPassword $containerId `
    psql --host 127.0.0.1 --username crm_backup --dbname lumina_crm `
    --command "begin; delete from app_meta.schema_migrations where false; rollback" 2>$null
  if ($LASTEXITCODE -eq 0) {
    throw "crm_backup unexpectedly has database write permission"
  }

  $backupRoot = Join-Path $secretRoot "backup-roundtrip"
  $dumpPath = Join-Path $backupRoot "database.dump"
  $encryptedPath = Join-Path $backupRoot "database.dump.enc"
  $decryptedPath = Join-Path $backupRoot "database.decrypted.dump"
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

  docker exec --env PGPASSWORD=$backupPassword $containerId `
    pg_dump --host 127.0.0.1 --username crm_backup --dbname lumina_crm `
    --format custom --compress 9 --no-owner --no-acl --file /tmp/lumina-integration.dump
  if ($LASTEXITCODE -ne 0) { throw "Read-only crm_backup pg_dump failed" }
  docker cp "${containerId}:/tmp/lumina-integration.dump" $dumpPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to copy the integration dump" }

  $env:BACKUP_ENCRYPTION_KEY = New-TestSecret
  node (Join-Path $repositoryRoot "scripts\backup-crypto-smoke.mjs") `
    $dumpPath $encryptedPath $decryptedPath
  if ($LASTEXITCODE -ne 0) { throw "AES-256-GCM backup round trip failed" }

  $restoreDatabase = "lumina_restore_$Suffix"
  docker exec --env PGPASSWORD=$superuserPassword $containerId `
    createdb --host 127.0.0.1 --username postgres $restoreDatabase
  if ($LASTEXITCODE -ne 0) { throw "Temporary restore database creation failed" }
  docker cp $decryptedPath "${containerId}:/tmp/lumina-integration-restored.dump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to copy the decrypted integration dump" }
  docker exec --env PGPASSWORD=$superuserPassword $containerId `
    pg_restore --exit-on-error --no-owner --no-acl `
    --host 127.0.0.1 --username postgres --dbname $restoreDatabase `
    /tmp/lumina-integration-restored.dump
  if ($LASTEXITCODE -ne 0) { throw "Temporary database pg_restore failed" }

  $restoreVerification = (docker exec --env PGPASSWORD=$superuserPassword $containerId `
    psql --host 127.0.0.1 --username postgres --dbname $restoreDatabase --tuples-only --no-align `
    --command "select (to_regclass('app_auth.accounts') is not null)::int || ':' || (to_regclass('public.workspaces') is not null)::int || ':' || ((select count(*) from app_meta.schema_migrations) > 0)::int").Trim()
  if ($restoreVerification -ne "1:1:1") {
    throw "Temporary restore verification failed"
  }
  docker exec --env PGPASSWORD=$superuserPassword $containerId `
    dropdb --force --if-exists --host 127.0.0.1 --username postgres $restoreDatabase
  if ($LASTEXITCODE -ne 0) { throw "Temporary restore database cleanup failed" }
  $remainingRestoreDatabases = (docker exec --env PGPASSWORD=$superuserPassword $containerId `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) from pg_database where datname='$restoreDatabase'").Trim()
  if ($remainingRestoreDatabases -ne "0") {
    throw "Temporary restore database still exists after cleanup"
  }
  $restoreDatabase = $null

  Write-Output "[compose:database:integration] PASS project=$project migrations=$migrationCount postgres_ports=none network=$backendNetwork backup=encrypted restore=clean"
} finally {
  if ($containerId) {
    if ($restoreDatabase) {
      docker exec --env PGPASSWORD=$superuserPassword $containerId `
        dropdb --force --if-exists --host 127.0.0.1 --username postgres $restoreDatabase 2>$null
    }
    docker rm --force $containerId | Out-Null
  }
  $existingNetwork = docker network ls --filter "name=^${backendNetwork}$" --format "{{.Name}}"
  if ($existingNetwork -eq $backendNetwork) {
    docker network rm $backendNetwork | Out-Null
  }
  $existingVolume = docker volume ls --filter "name=^${postgresVolume}$" --format "{{.Name}}"
  if ($existingVolume -eq $postgresVolume) {
    docker volume rm $postgresVolume | Out-Null
  }
  if (Test-Path -LiteralPath $secretRoot) {
    Remove-Item -LiteralPath $secretRoot -Recurse -Force
  }
  foreach ($name in @(
    "LUMINA_COMPOSE_PROJECT",
    "LUMINA_BACKEND_NETWORK",
    "LUMINA_POSTGRES_VOLUME",
    "LUMINA_SECRETS_DIR"
  )) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
  Remove-Item -Path "Env:BACKUP_ENCRYPTION_KEY" -ErrorAction SilentlyContinue
}
