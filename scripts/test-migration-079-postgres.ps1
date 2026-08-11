param([string]$Suffix = ([guid]::NewGuid().ToString("N").Substring(0, 10)))

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$container = "lumina-crm-migration-079-it-$Suffix"
$stageRoot = Join-Path $repositoryRoot "work\migration-079-$Suffix"
$stageScripts = Join-Path $stageRoot "scripts"
$stageMigrations = Join-Path $stageRoot "db\migrations"
$migration079Name = "202608110079_all_staff_team_membership.sql"
$migration078Name = "202608110078_product_lifecycle_and_contact_operating_profile.sql"

if ($container -notmatch '^lumina-crm-migration-079-it-[a-f0-9]{10}$') {
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
  $through078 = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "db\migrations") -Filter "*.sql" |
    Where-Object { $_.Name -le $migration078Name } | Sort-Object Name)
  if ($through078.Count -lt 1 -or $through078[-1].Name -ne $migration078Name -or $through078.Name -contains $migration079Name) {
    throw "Expected an exact foundation-through-078 migration prefix"
  }
  foreach ($migration in $through078) {
    Copy-Item -LiteralPath $migration.FullName -Destination $stageMigrations
  }

  docker run --detach --rm --name $container `
    --label com.lumina.crm.test=migration-079 `
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
  if ($LASTEXITCODE -ne 0) { throw "Foundation-through-078 migration failed" }

  $seedSql = @"
insert into app_auth.accounts(id,email,username) values
('00000000-0000-4000-8000-000000000910','super.team@example.test','super.team'),
('00000000-0000-4000-8000-000000000911','admin.team@example.test','admin.team');
insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) values
('00000000-0000-4000-8000-000000000910','super.team','Super Admin ZH','Super Administrator'),
('00000000-0000-4000-8000-000000000911','admin.team','Admin ZH','Administrator');
insert into public.workspace_memberships(workspace_id,user_id,role,status) values
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000910','SUPER_ADMIN','ACTIVE'),
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000911','ADMIN','ACTIVE');
"@
  docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --set ON_ERROR_STOP=1 --command $seedSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Administrative staff fixture insert failed" }

  $before079 = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) from public.sales_team_members where auth_user_id in ('00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000911')").Trim()
  if ($before079 -ne "0") { throw "Administrator fixtures unexpectedly had legacy team-member rows: $before079" }

  $migration079Path = Join-Path $repositoryRoot "db\migrations\$migration079Name"
  Copy-Item -LiteralPath $migration079Path -Destination $stageMigrations
  node (Join-Path $stageScripts "db-migrate.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Migration 079 failed against PostgreSQL" }

  $membershipSql = @"
insert into public.sales_teams(id,workspace_id,code,name_zh,name_en,created_by) values
('00000000-0000-4000-8000-000000000920','00000000-0000-4000-8000-000000000001','OPS-A','Operations A ZH','Operations A','00000000-0000-4000-8000-000000000910'),
('00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000001','OPS-B','Operations B ZH','Operations B','00000000-0000-4000-8000-000000000910');
insert into public.sales_team_memberships(workspace_id,team_id,member_id,membership_role,status,requested_by,reviewed_by,reviewed_at)
select member.workspace_id,'00000000-0000-4000-8000-000000000920',member.id,
  case when member.role='SUPER_ADMIN' then 'LEAD' else 'MEMBER' end,'ACTIVE',
  '00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000910',now()
from public.sales_team_members member
where member.auth_user_id in ('00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000911');
insert into public.sales_team_memberships(workspace_id,team_id,member_id,membership_role,status,requested_by,reviewed_by,reviewed_at)
select member.workspace_id,'00000000-0000-4000-8000-000000000921',member.id,'LEAD','ACTIVE',
  '00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000910',now()
from public.sales_team_members member where member.auth_user_id='00000000-0000-4000-8000-000000000910';
update public.sales_teams set lead_member_id=(
  select id from public.sales_team_members where auth_user_id='00000000-0000-4000-8000-000000000910'
) where id in ('00000000-0000-4000-8000-000000000920','00000000-0000-4000-8000-000000000921');
"@
  docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --set ON_ERROR_STOP=1 --command $membershipSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Administrative team membership assignment failed" }

  $assertion = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select
      (select count(*) from public.sales_team_members where auth_user_id in ('00000000-0000-4000-8000-000000000910','00000000-0000-4000-8000-000000000911') and role in ('SUPER_ADMIN','ADMIN') and active) || ':' ||
      (select count(*) from public.sales_team_memberships membership join public.sales_team_members member on member.id=membership.member_id where member.auth_user_id='00000000-0000-4000-8000-000000000910' and membership.status='ACTIVE') || ':' ||
      (select count(*) from public.sales_team_memberships membership join public.sales_team_members member on member.id=membership.member_id where member.auth_user_id='00000000-0000-4000-8000-000000000911' and membership.status='ACTIVE') || ':' ||
      (select count(*) from public.sales_teams team join public.sales_team_members member on member.id=team.lead_member_id where member.auth_user_id='00000000-0000-4000-8000-000000000910') || ':' ||
      (select count(*) from pg_constraint where conrelid='public.sales_team_members'::regclass and contype='c' and pg_get_constraintdef(oid) like '%SUPER_ADMIN%' and pg_get_constraintdef(oid) like '%ADMIN%')").Trim()
  if ($assertion -ne "2:2:1:2:1") {
    throw "All-role team membership assertions failed: $assertion"
  }

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $expectedChecksum = ([BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($migration079Path)))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  $recordedChecksum = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select checksum from app_meta.schema_migrations where name='$migration079Name'").Trim()
  if ($recordedChecksum -ne $expectedChecksum) { throw "Migration 079 checksum was not recorded exactly" }

  $migrationCount = (docker exec --env PGPASSWORD=$postgresPassword $container `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm --tuples-only --no-align `
    --command "select count(*) from app_meta.schema_migrations").Trim()
  $expectedMigrationCount = $through078.Count + 1
  if ([int]$migrationCount -ne $expectedMigrationCount) {
    throw "Complete foundation-through-079 chain was not recorded: $migrationCount"
  }

  Write-Output "[migration-079-postgres] PASS full_chain=$migrationCount administrative_members=2 super_admin_teams=2 admin_teams=1 checksum=$recordedChecksum"
} finally {
  $existing = docker ps --all --filter "name=^/${container}$" --format "{{.Names}}"
  if ($existing -eq $container) { docker rm --force $container | Out-Null }
  if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
  foreach ($name in @("NODE_ENV","DATABASE_ADMIN_URL","MIGRATION_DATABASE_URL","CRM_APP_DB_PASSWORD","CRM_SYSTEM_DB_PASSWORD","CRM_WORKER_DB_PASSWORD","CRM_MIGRATOR_DB_PASSWORD","CRM_BACKUP_DB_PASSWORD")) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
}
