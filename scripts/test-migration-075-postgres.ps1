param([string]$Suffix = ([guid]::NewGuid().ToString("N").Substring(0, 10)))

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$container = "lumina-crm-migration-075-it-$Suffix"
$stageRoot = Join-Path $repositoryRoot "work\migration-075-$Suffix"
$stageScripts = Join-Path $stageRoot "scripts"
$stageMigrations = Join-Path $stageRoot "db\migrations"
$migration075Name = "202608110075_structured_profiles_teams_and_terminal_approvals.sql"
$migration074Name = "202608100074_persistent_session_retention.sql"

if ($container -notmatch '^lumina-crm-migration-075-it-[a-f0-9]{10}$') {
  throw "Invalid isolated migration test name"
}
$resolvedWorkRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "work"))
$resolvedStageRoot = [IO.Path]::GetFullPath($stageRoot)
if (!$resolvedStageRoot.StartsWith($resolvedWorkRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing migration stage outside the repository work directory"
}

function New-TestSecret {
  return ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
}

$postgresPassword = New-TestSecret
$appPassword = New-TestSecret
$systemPassword = New-TestSecret
$workerPassword = New-TestSecret
$migratorPassword = New-TestSecret
$backupPassword = New-TestSecret

try {
  New-Item -ItemType Directory -Path $stageScripts -Force | Out-Null
  New-Item -ItemType Directory -Path $stageMigrations -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\db-migrate.mjs") -Destination $stageScripts
  $through074 = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "db\migrations") -Filter "*.sql" |
    Where-Object { $_.Name -le $migration074Name } | Sort-Object Name)
  if ($through074.Count -lt 1 -or $through074[-1].Name -ne $migration074Name -or $through074.Name -contains $migration075Name) {
    throw "Expected an exact foundation-through-074 migration prefix"
  }
  foreach ($migration in $through074) {
    Copy-Item -LiteralPath $migration.FullName -Destination $stageMigrations
  }

  docker run --detach --rm --name $container `
    --label com.lumina.crm.test=migration-075 `
    --publish 127.0.0.1::5432 `
    --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=768m `
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

  $hostPort = (docker port $container 5432/tcp).Split(":")[-1].Trim()
  if ($hostPort -notmatch '^\d{4,5}$') { throw "Isolated PostgreSQL loopback port was not resolved" }
  $env:NODE_ENV = "test"
  $env:DATABASE_ADMIN_URL = "postgresql://postgres:$postgresPassword@127.0.0.1:$hostPort/lumina_crm"
  $env:MIGRATION_DATABASE_URL = "postgresql://crm_migrator:$migratorPassword@127.0.0.1:$hostPort/lumina_crm"
  $env:CRM_APP_DB_PASSWORD = $appPassword
  $env:CRM_SYSTEM_DB_PASSWORD = $systemPassword
  $env:CRM_WORKER_DB_PASSWORD = $workerPassword
  $env:CRM_MIGRATOR_DB_PASSWORD = $migratorPassword
  $env:CRM_BACKUP_DB_PASSWORD = $backupPassword

  node (Join-Path $repositoryRoot "scripts\db-bootstrap.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Database bootstrap failed" }
  node (Join-Path $stageScripts "db-migrate.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Foundation-through-074 migration failed" }

  $before075 = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) || ':' || count(*) filter(where name='$migration075Name') from app_meta.schema_migrations").Trim()
  if ($before075 -ne "$($through074.Count):0") { throw "Database was not staged exactly through migration 074: $before075" }

  $seedSql = @"
insert into public.sales_team_members(workspace_id,name_zh,name_en,role,team,active) values
('00000000-0000-4000-8000-000000000001','旧团队甲','Legacy Alpha Manager','SALES_MANAGER','Legacy Alpha',true),
('00000000-0000-4000-8000-000000000001','旧团队乙','Legacy Alpha Specialist','SALES_SPECIALIST','Legacy Alpha',true),
('00000000-0000-4000-8000-000000000001','旧团队丙','Legacy Chinese Support','SALES_SUPPORT','中文团队',true);
"@
  docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --set ON_ERROR_STOP=1 --command $seedSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Legacy sales-team fixture insert failed" }

  $migration075Path = Join-Path $repositoryRoot "db\migrations\$migration075Name"
  Copy-Item -LiteralPath $migration075Path -Destination $stageMigrations
  node (Join-Path $stageScripts "db-migrate.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Migration 075 failed against PostgreSQL" }

  $assertion = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select
      (select count(*) from public.sales_teams where name_en in ('Legacy Alpha','中文团队')) || ':' ||
      (select count(*) from public.sales_teams where name_en in ('Legacy Alpha','中文团队') and created_by is null) || ':' ||
      (select count(*) from public.sales_team_members where team in ('Legacy Alpha','中文团队')) || ':' ||
      (select count(*) from public.sales_team_members where team in ('Legacy Alpha','中文团队') and team_id is not null) || ':' ||
      (select count(distinct team_id) from public.sales_team_members where team in ('Legacy Alpha','中文团队')) || ':' ||
      (select count(*) from public.sales_teams where name_en='Legacy Alpha') || ':' ||
      (select count(distinct team_id) from public.sales_team_members where team='Legacy Alpha')").Trim()
  if ($assertion -ne "2:2:3:3:2:1:1") {
    throw "Migration 075 legacy-team backfill assertions failed: $assertion"
  }

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $expectedChecksum = ([BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($migration075Path)))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  $recordedChecksum = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select checksum from app_meta.schema_migrations where name='$migration075Name'").Trim()
  if ($recordedChecksum -ne $expectedChecksum) {
    throw "Migration 075 checksum was not recorded exactly"
  }

  $migrationCount = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) from app_meta.schema_migrations").Trim()
  $expectedMigrationCount = $through074.Count + 1
  if ([int]$migrationCount -ne $expectedMigrationCount) {
    throw "Complete foundation-through-075 chain was not recorded: $migrationCount"
  }

  Write-Output "[migration-075-postgres] PASS prefix=074 full_chain=$migrationCount teams=2 members=3 checksum=$recordedChecksum"
} finally {
  $existing = docker ps --all --filter "name=^/${container}$" --format "{{.Names}}"
  if ($existing -eq $container) { docker rm --force $container | Out-Null }
  if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
  foreach ($name in @("NODE_ENV","DATABASE_ADMIN_URL","MIGRATION_DATABASE_URL","CRM_APP_DB_PASSWORD","CRM_SYSTEM_DB_PASSWORD","CRM_WORKER_DB_PASSWORD","CRM_MIGRATOR_DB_PASSWORD","CRM_BACKUP_DB_PASSWORD")) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
}
