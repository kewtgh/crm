$ErrorActionPreference = 'Stop'

function New-RandomSecret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function New-HexSecret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

$envPath = Join-Path $PWD '.env.local'
$values = [ordered]@{}
if (Test-Path -LiteralPath $envPath) {
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $values[$matches[1]] = $matches[2]
    }
  }
}
foreach ($retiredKey in @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD'
)) {
  $values.Remove($retiredKey)
}
function Set-Value([string]$Key, [string]$Value) { $values[$Key] = $Value }
function Set-Default([string]$Key, [string]$Value) {
  if (-not $values.Contains($Key) -or [string]::IsNullOrWhiteSpace([string]$values[$Key])) {
    $values[$Key] = $Value
  }
}

$database = 'postgresql://crm_app:local-app-password@127.0.0.1:55432/lumina_crm'
$systemDatabase = 'postgresql://crm_system:local-system-password@127.0.0.1:55432/lumina_crm'
$workerDatabase = 'postgresql://crm_worker:local-worker-password@127.0.0.1:55432/lumina_crm'
$migrationDatabase = 'postgresql://crm_migrator:local-migrator-password@127.0.0.1:55432/lumina_crm'
$adminDatabase = 'postgresql://postgres:lumina-local-admin-only@127.0.0.1:55432/lumina_crm'
$backupDatabase = 'postgresql://crm_backup:local-backup-password@127.0.0.1:55432/lumina_crm'

Set-Value 'APP_URL' 'http://localhost:3200'
Set-Value 'DATABASE_URL' $database
Set-Value 'SYSTEM_DATABASE_URL' $systemDatabase
Set-Value 'WORKER_DATABASE_URL' $workerDatabase
Set-Value 'MIGRATION_DATABASE_URL' $migrationDatabase
Set-Value 'DATABASE_ADMIN_URL' $adminDatabase
Set-Value 'BACKUP_DATABASE_URL' $backupDatabase
Set-Value 'DATABASE_SSL' 'false'
Set-Value 'CRM_APP_DB_PASSWORD' 'local-app-password'
Set-Value 'CRM_SYSTEM_DB_PASSWORD' 'local-system-password'
Set-Value 'CRM_WORKER_DB_PASSWORD' 'local-worker-password'
Set-Value 'CRM_MIGRATOR_DB_PASSWORD' 'local-migrator-password'
Set-Value 'CRM_BACKUP_DB_PASSWORD' 'local-backup-password'
Set-Value 'NEXT_PUBLIC_TURNSTILE_SITE_KEY' '1x00000000000000000000AA'
Set-Value 'TURNSTILE_SECRET_KEY' '1x0000000000000000000000000000000AA'
Set-Value 'TURNSTILE_EXPECTED_HOSTNAME' 'localhost'
Set-Default 'ALTCHA_HMAC_SECRET' (New-RandomSecret)
Set-Default 'CRM_WORKSPACE_ID' '00000000-0000-4000-8000-000000000001'
Set-Default 'LOGIN_THROTTLE_HASH_SECRET' (New-RandomSecret)
Set-Default 'TRUSTED_DEVICE_HASH_SECRET' (New-RandomSecret)
Set-Default 'TOTP_ENCRYPTION_KEY' (New-HexSecret)
Set-Default 'OBJECT_STORAGE_SIGNING_SECRET' (New-RandomSecret)
Set-Value 'OBJECT_STORAGE_PROVIDER' 'local'
Set-Value 'OBJECT_STORAGE_LOCAL_ROOT' (Join-Path $PWD 'work\object-storage')

foreach ($key in @(
  'WEBHOOK_MICROSOFT_365_SECRET',
  'WEBHOOK_GOOGLE_CALENDAR_SECRET',
  'WEBHOOK_EMAIL_SECRET',
  'WEBHOOK_E_SIGNATURE_SECRET',
  'WEBHOOK_ACCOUNTING_SECRET',
  'WEBHOOK_PAYMENT_SECRET'
)) { Set-Default $key (New-RandomSecret) }

foreach ($entry in @{
  WORKER_JOB_CONCURRENCY = '4'
  OUTBOX_BATCH_SIZE = '20'
  CALENDAR_DELIVERY_BATCH_SIZE = '20'
  EXPORT_BATCH_SIZE = '10'
  EXPORT_MAX_ROWS = '250000'
  REMINDER_BATCH_SIZE = '100'
  WEBHOOK_BATCH_SIZE = '20'
  INTEGRATION_SYNC_BATCH_SIZE = '10'
}.GetEnumerator()) { Set-Default $entry.Key $entry.Value }

foreach ($entry in @{
  WEBHOOKS_ENABLED = 'false'
  INTEGRATION_SYNC_ENABLED = 'false'
  OBSERVABILITY_ENABLED = 'false'
  SSO_ENABLED = 'false'
  SCIM_ENABLED = 'false'
  AI_PROVIDER_ENABLED = 'false'
}.GetEnumerator()) { Set-Default $entry.Key $entry.Value }

Set-Default 'EMAIL_DELIVERY_WEBHOOK_URL' 'http://127.0.0.1:3999/delivery'
Set-Default 'EMAIL_DELIVERY_WEBHOOK_TOKEN' (New-RandomSecret)
foreach ($key in @(
  'WEBHOOK_PROCESSOR_URL',
  'WEBHOOK_PROCESSOR_TOKEN',
  'INTEGRATION_SYNC_PROCESSOR_URL',
  'INTEGRATION_SYNC_PROCESSOR_TOKEN',
  'AI_PROVIDER_URL',
  'AI_PROVIDER_TOKEN',
  'WORKER_ID'
)) { Set-Default $key '' }

Set-Default 'ADMIN_EMAIL' 'admin@lumina.local'
Set-Default 'ADMIN_PASSWORD' "L!9$(New-RandomSecret 18)"
Set-Default 'ADMIN_CHINESE_NAME' "$([char]0x7CFB)$([char]0x7EDF)$([char]0x7BA1)$([char]0x7406)$([char]0x5458)"
Set-Default 'ADMIN_ENGLISH_NAME' 'Lumina Administrator'
Set-Default 'ADMIN_USERNAME' 'lumina.admin'
Set-Default 'ADMIN_ROTATE_PASSWORD' 'false'
Set-Value 'ADMIN_CREDENTIAL_OUTPUT_PATH' (Join-Path $PWD 'work\local-admin-credential.txt')

$lines = @(
  '# Generated for the isolated Lumina CRM PostgreSQL stack. Existing and unknown keys are preserved.',
  '# External integration URLs remain blank until a real local adapter is configured.'
)
$lines += $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))

docker compose -f compose.postgres.yml up -d
$deadline = (Get-Date).AddSeconds(60)
do {
  $health = docker inspect --format='{{.State.Health.Status}}' crm-postgres-1 2>$null
  if ($health -eq 'healthy') { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
if ($health -ne 'healthy') { throw 'The local PostgreSQL container did not become healthy.' }

npm run db:bootstrap
npm run db:migrate
npm run auth:bootstrap-admin
$values.Remove('ADMIN_PASSWORD')
$lines = @(
  '# Generated for the isolated Lumina CRM PostgreSQL stack. Existing and unknown keys are preserved.',
  '# External integration URLs remain blank until a real local adapter is configured.'
)
$lines += $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Configured the isolated PostgreSQL development environment without exposing secret values.'
