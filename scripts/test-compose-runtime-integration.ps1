param(
  [string]$Suffix = ([guid]::NewGuid().ToString("N").Substring(0, 10)),
  [string]$ApplicationImage = "lumina-crm-validation:3.8.18",
  [string]$OperationsImage = "lumina-crm-ops-validation:3.8.18"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $repositoryRoot "compose.production.yml"
$project = "lumina-crm-rt-$Suffix"
$backendNetwork = "$project-backend"
$edgeNetwork = "$project-edge"
$postgresVolume = "$project-postgres-data"
$objectsVolume = "$project-objects"
$backupsVolume = "$project-backups"
$secretRoot = Join-Path $repositoryRoot "work\$project-secrets"
$candidateTag = "lumina-crm-runtime-candidate-$Suffix`:3.8.18"
$rollbackTag = "lumina-crm-runtime-rollback-$Suffix`:3.8.18"
$workspaceId = "00000000-0000-4000-8000-000000000001"

foreach ($value in @($project, $backendNetwork, $edgeNetwork, $postgresVolume, $objectsVolume, $backupsVolume)) {
  if ($value -notmatch '^lumina-crm-rt-[a-f0-9]{10}(?:-(?:backend|edge|postgres-data|objects|backups))?$') {
    throw "Refusing non-isolated runtime resource name: $value"
  }
}

function New-TestSecret {
  return ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
}

function Assert-LuminaImage([string]$Image) {
  $inspection = docker image inspect $Image | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$inspection) { throw "Required test image is missing: $Image" }
  $labels = $inspection[0].Config.Labels
  if ($labels.'com.lumina.crm.managed' -ne "true" -or
    $labels.'com.lumina.crm.repository' -ne "kewtgh/crm" -or
    $labels.'com.docker.compose.project' -ne "lumina-crm") {
    throw "Refusing image without the complete Lumina identity: $Image"
  }
}

function New-LuminaVolume([string]$Name) {
  docker volume create `
    --label com.lumina.crm.managed=true `
    --label com.lumina.crm.repository=kewtgh/crm `
    --label com.docker.compose.project=$project `
    $Name | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create isolated volume: $Name" }
}

function Initialize-WritableVolume([string]$Name, [string]$Purpose) {
  docker run --rm `
    --name "$project-volume-$Purpose" `
    --label com.lumina.crm.managed=true `
    --label com.lumina.crm.repository=kewtgh/crm `
    --label com.docker.compose.project=$project `
    --network none --read-only --user 0:0 `
    --cap-drop ALL --cap-add CHOWN `
    --security-opt no-new-privileges:true `
    --mount "type=volume,src=$Name,dst=/data" `
    --entrypoint chown postgres:18.4-bookworm 10001:10001 /data
  if ($LASTEXITCODE -ne 0) { throw "Failed to initialize $Purpose volume ownership" }
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose --file $composeFile @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Compose command failed: $($Arguments -join ' ')"
  }
}

function Wait-ContainerHealth([string]$Service, [int]$Seconds = 120) {
  $name = "$project-$Service-1"
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
  $last = ""
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $status = (docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" $name 2>$null).Trim()
    if ($status -ne $last) {
      Write-Output "[compose:runtime] $Service health=$status"
      $last = $status
    }
    if ($status -eq "healthy") { return }
    if ($status -eq "unhealthy") { throw "$Service became unhealthy" }
    Start-Sleep -Seconds 2
  }
  throw "$Service did not become healthy within $Seconds seconds"
}

function Get-HealthResponse([string]$Path) {
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(20)
  try {
    $response = $client.GetAsync(
      "http://127.0.0.1:$webPort$Path"
    ).GetAwaiter().GetResult()
    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  } finally {
    $client.Dispose()
  }
}

function Get-ContainerInspection([string]$Name) {
  $inspection = docker inspect $Name | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$inspection) {
    throw "Container inspection failed: $Name"
  }
  return $inspection[0]
}

function Write-SecretFile([string]$Name, [string]$Content) {
  Set-Content -LiteralPath (Join-Path $secretRoot $Name) -Value $Content -NoNewline
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$webPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$superuserPassword = New-TestSecret
$appPassword = New-TestSecret
$systemPassword = New-TestSecret
$workerPassword = New-TestSecret
$migratorPassword = New-TestSecret
$backupPassword = New-TestSecret
$emailDeliveryToken = New-TestSecret
$candidateTagCreated = $false
$rollbackTagCreated = $false

try {
  Assert-LuminaImage $ApplicationImage
  Assert-LuminaImage $OperationsImage
  New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null

  Write-SecretFile "postgres-superuser-password.txt" $superuserPassword
  Write-SecretFile "database-bootstrap.env" @"
DATABASE_ADMIN_URL=postgresql://postgres:$superuserPassword@postgres:5432/lumina_crm
CRM_APP_DB_PASSWORD=$appPassword
CRM_SYSTEM_DB_PASSWORD=$systemPassword
CRM_WORKER_DB_PASSWORD=$workerPassword
CRM_MIGRATOR_DB_PASSWORD=$migratorPassword
CRM_BACKUP_DB_PASSWORD=$backupPassword
DATABASE_SSL=false
"@
  Write-SecretFile "migration.env" @"
MIGRATION_DATABASE_URL=postgresql://crm_migrator:$migratorPassword@postgres:5432/lumina_crm
DATABASE_SSL=false
"@
  Write-SecretFile "bootstrap-admin.env" @"
SYSTEM_DATABASE_URL=postgresql://crm_system:$systemPassword@postgres:5432/lumina_crm
ADMIN_EMAIL=runtime-$Suffix@example.com
ADMIN_PASSWORD=$(New-TestSecret)
ADMIN_USERNAME=runtime.$Suffix
CRM_WORKSPACE_ID=$workspaceId
DATABASE_SSL=false
"@
  Write-SecretFile "production.env" @"
APP_URL=http://127.0.0.1:$webPort
NEXT_PUBLIC_TURNSTILE_SITE_KEY=runtime-site-$Suffix
TURNSTILE_SECRET_KEY=$(New-TestSecret)
TURNSTILE_EXPECTED_HOSTNAME=127.0.0.1
ALTCHA_HMAC_SECRET=$(New-TestSecret)
DATABASE_URL=postgresql://crm_app:$appPassword@postgres:5432/lumina_crm
SYSTEM_DATABASE_URL=postgresql://crm_system:$systemPassword@postgres:5432/lumina_crm
DATABASE_SSL=false
DATABASE_POOL_MAX=4
SYSTEM_DATABASE_POOL_MAX=2
CRM_WORKSPACE_ID=$workspaceId
LOGIN_THROTTLE_HASH_SECRET=$(New-TestSecret)
TRUSTED_DEVICE_HASH_SECRET=$(New-TestSecret)
TOTP_ENCRYPTION_KEY=$(New-TestSecret)
OBJECT_STORAGE_SIGNING_SECRET=$(New-TestSecret)
OBJECT_STORAGE_PROVIDER=local
OBJECT_STORAGE_LOCAL_ROOT=/var/lib/lumina-crm/objects
EMAIL_DELIVERY_WEBHOOK_URL=https://mailer.example.test/delivery
EMAIL_DELIVERY_WEBHOOK_TOKEN=$emailDeliveryToken
WEBHOOKS_ENABLED=false
INTEGRATION_SYNC_ENABLED=false
SSO_ENABLED=false
SCIM_ENABLED=false
OBSERVABILITY_ENABLED=false
AI_PROVIDER_ENABLED=false
"@
  Write-SecretFile "worker.env" @"
WORKER_DATABASE_URL=postgresql://crm_worker:$workerPassword@postgres:5432/lumina_crm
WORKER_DATABASE_POOL_MAX=2
CRM_WORKSPACE_ID=$workspaceId
WORKER_ID=runtime-$Suffix
OBJECT_STORAGE_PROVIDER=local
OBJECT_STORAGE_LOCAL_ROOT=/var/lib/lumina-crm/objects
EMAIL_DELIVERY_WEBHOOK_URL=https://mailer.example.test/delivery
EMAIL_DELIVERY_WEBHOOK_TOKEN=$emailDeliveryToken
WORKER_JOB_CONCURRENCY=4
OUTBOX_BATCH_SIZE=20
CALENDAR_DELIVERY_BATCH_SIZE=20
COMMUNICATION_DELIVERY_BATCH_SIZE=20
EXPORT_BATCH_SIZE=10
EXPORT_MAX_ROWS=250000
REMINDER_BATCH_SIZE=100
WEBHOOKS_ENABLED=false
INTEGRATION_SYNC_ENABLED=false
OBSERVABILITY_ENABLED=false
SSO_ENABLED=false
SCIM_ENABLED=false
"@
  foreach ($name in @("backup.env", "restore.env")) {
    Write-SecretFile $name "# isolated runtime placeholder"
  }

  New-LuminaVolume $postgresVolume
  New-LuminaVolume $objectsVolume
  New-LuminaVolume $backupsVolume
  Initialize-WritableVolume $objectsVolume "objects"
  Initialize-WritableVolume $backupsVolume "backups"

  $env:LUMINA_COMPOSE_PROJECT = $project
  $env:LUMINA_BACKEND_NETWORK = $backendNetwork
  $env:LUMINA_EDGE_NETWORK = $edgeNetwork
  $env:LUMINA_POSTGRES_VOLUME = $postgresVolume
  $env:LUMINA_OBJECTS_VOLUME = $objectsVolume
  $env:LUMINA_BACKUPS_VOLUME = $backupsVolume
  $env:LUMINA_SECRETS_DIR = $secretRoot
  $env:LUMINA_IMAGE = $ApplicationImage
  $env:LUMINA_OPS_IMAGE = $OperationsImage
  $env:LUMINA_WEB_BIND = "127.0.0.1:$webPort"
  $env:LUMINA_PUBLIC_HOSTNAME = "127.0.0.1"
  $env:WORKER_LOOP_INTERVAL_SECONDS = "300"

  Invoke-Compose @("up", "--detach", "--wait", "postgres")
  Invoke-Compose @("--profile", "ops", "run", "--rm", "--no-deps", "db-bootstrap")
  Invoke-Compose @("--profile", "ops", "run", "--rm", "--no-deps", "migration-verify")
  Invoke-Compose @("--profile", "ops", "run", "--rm", "--no-deps", "migrate")
  Invoke-Compose @("--profile", "ops", "run", "--rm", "--no-deps", "bootstrap-admin")

  $ErrorActionPreference = "Continue"
  $missingOutput = (& docker compose --file $composeFile run --rm --no-deps worker worker-health 2>&1) -join "`n"
  $missingExitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($missingExitCode -eq 0 -or $missingOutput -notmatch "WORKER_HEALTH_(MISSING|STALE)WORKERS") {
    throw "Worker health did not reject missing heartbeat state"
  }

  Invoke-Compose @("up", "--detach", "--no-deps", "web", "worker")
  Wait-ContainerHealth "web"
  Wait-ContainerHealth "worker"

  $liveness = Get-HealthResponse "/api/health"
  $livenessBody = $liveness.Content | ConvertFrom-Json
  if ($liveness.StatusCode -ne 200 -or $livenessBody.status -ne "ok" -or
    $livenessBody.PSObject.Properties.Name -contains "checks") {
    throw "Public liveness contract failed"
  }
  $readiness = Get-HealthResponse "/api/health?mode=ready"
  $readinessBody = $readiness.Content | ConvertFrom-Json
  if ($readiness.StatusCode -ne 200 -or $readinessBody.status -ne "ok") {
    throw "Loopback readiness did not become healthy"
  }

  $postgresContainer = "$project-postgres-1"
  $workerContainer = "$project-worker-1"
  $webContainer = "$project-web-1"
  $postgresInspection = Get-ContainerInspection $postgresContainer
  $postgresId = [string]$postgresInspection.Id
  $postgresMount = [string]((
    $postgresInspection.Mounts |
      Where-Object { $_.Destination -eq "/var/lib/postgresql" } |
      Select-Object -First 1
  ).Name)

  docker stop $workerContainer | Out-Null
  docker exec --env PGPASSWORD=$superuserPassword $postgresContainer `
    psql --host 127.0.0.1 --username postgres --dbname lumina_crm `
    --command "update public.worker_heartbeats set last_seen_at=now()-interval '20 minutes'" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create stale heartbeat fixture" }
  $ErrorActionPreference = "Continue"
  $staleOutput = (& docker compose --file $composeFile run --rm --no-deps worker worker-health 2>&1) -join "`n"
  $staleExitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($staleExitCode -eq 0 -or $staleOutput -notmatch "WORKER_HEALTH_STALEWORKERS") {
    throw "Worker health did not reject stale heartbeat state"
  }
  docker start $workerContainer | Out-Null
  Wait-ContainerHealth "worker"

  docker stop $postgresContainer | Out-Null
  $liveWithoutDatabase = Get-HealthResponse "/api/health"
  $readyWithoutDatabase = Get-HealthResponse "/api/health?mode=ready"
  if ($liveWithoutDatabase.StatusCode -ne 200 -or $readyWithoutDatabase.StatusCode -ne 503) {
    throw "Liveness/readiness database failure boundary failed"
  }
  if ((docker inspect --format "{{.State.Running}}" $webContainer).Trim() -ne "true") {
    throw "Web stopped when PostgreSQL became unavailable"
  }
  docker start $postgresContainer | Out-Null
  Wait-ContainerHealth "postgres"
  $recoveredReadiness = Get-HealthResponse "/api/health?mode=ready"
  if ($recoveredReadiness.StatusCode -ne 200) {
    throw "Readiness did not recover after PostgreSQL restart"
  }

  docker image tag $ApplicationImage $candidateTag
  if ($LASTEXITCODE -ne 0) { throw "Failed to create candidate test tag" }
  $candidateTagCreated = $true
  docker image tag $ApplicationImage $rollbackTag
  if ($LASTEXITCODE -ne 0) { throw "Failed to create rollback test tag" }
  $rollbackTagCreated = $true

  $env:LUMINA_IMAGE = $candidateTag
  Invoke-Compose @("up", "--detach", "--no-deps", "--force-recreate", "web", "worker")
  Wait-ContainerHealth "web"
  Wait-ContainerHealth "worker"
  $env:LUMINA_IMAGE = $rollbackTag
  Invoke-Compose @("up", "--detach", "--no-deps", "--force-recreate", "web", "worker")
  Wait-ContainerHealth "web"
  Wait-ContainerHealth "worker"

  $postgresInspectionAfter = Get-ContainerInspection $postgresContainer
  $webInspectionAfter = Get-ContainerInspection "$project-web-1"
  $postgresIdAfter = [string]$postgresInspectionAfter.Id
  $postgresMountAfter = [string]((
    $postgresInspectionAfter.Mounts |
      Where-Object { $_.Destination -eq "/var/lib/postgresql" } |
      Select-Object -First 1
  ).Name)
  $restoredImage = [string]$webInspectionAfter.Config.Image
  if ($postgresIdAfter -ne $postgresId -or $postgresMountAfter -ne $postgresMount -or
    $postgresMountAfter -ne $postgresVolume -or $restoredImage -ne $rollbackTag) {
    throw "Image rollback changed the PostgreSQL container/volume or failed to restore the rollback tag"
  }
  if ((Get-HealthResponse "/api/health?mode=ready").StatusCode -ne 200) {
    throw "Rollback image did not pass readiness"
  }

  Write-Output "[compose:runtime:integration] PASS project=$project liveness=minimal readiness=database-aware worker=heartbeat-aware rollback=forward-schema postgres_volume=preserved"
} finally {
  $containers = @(docker ps --all --filter "label=com.docker.compose.project=$project" --format "{{.ID}} {{.Names}}")
  foreach ($line in $containers) {
    if (!$line) { continue }
    $parts = $line -split " ", 2
    if ($parts.Count -ne 2 -or $parts[1] -notmatch "^$([regex]::Escape($project))-") {
      throw "Refusing to remove container outside isolated project: $line"
    }
    docker rm --force $parts[0] | Out-Null
  }
  foreach ($network in @($backendNetwork, $edgeNetwork)) {
    if ((docker network ls --filter "name=^${network}$" --format "{{.Name}}") -eq $network) {
      docker network rm $network | Out-Null
    }
  }
  foreach ($volume in @($postgresVolume, $objectsVolume, $backupsVolume)) {
    if ((docker volume ls --filter "name=^${volume}$" --format "{{.Name}}") -eq $volume) {
      docker volume rm $volume | Out-Null
    }
  }
  if ($candidateTagCreated) { docker image rm $candidateTag | Out-Null }
  if ($rollbackTagCreated) { docker image rm $rollbackTag | Out-Null }
  if (Test-Path -LiteralPath $secretRoot) {
    Remove-Item -LiteralPath $secretRoot -Recurse -Force
  }
  foreach ($name in @(
    "LUMINA_COMPOSE_PROJECT",
    "LUMINA_BACKEND_NETWORK",
    "LUMINA_EDGE_NETWORK",
    "LUMINA_POSTGRES_VOLUME",
    "LUMINA_OBJECTS_VOLUME",
    "LUMINA_BACKUPS_VOLUME",
    "LUMINA_SECRETS_DIR",
    "LUMINA_IMAGE",
    "LUMINA_OPS_IMAGE",
    "LUMINA_WEB_BIND",
    "LUMINA_PUBLIC_HOSTNAME",
    "WORKER_LOOP_INTERVAL_SECONDS"
  )) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
}
