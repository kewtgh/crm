$ErrorActionPreference = 'Stop'

function Get-ContainerEnvironment([string]$ContainerName) {
  $inspection = docker inspect $ContainerName | ConvertFrom-Json
  if (-not $inspection) { throw "Container not found: $ContainerName" }
  $result = @{}
  foreach ($entry in $inspection[0].Config.Env) {
    $parts = $entry -split '=', 2
    if ($parts.Count -eq 2) { $result[$parts[0]] = $parts[1] }
  }
  return $result
}

function New-RandomSecret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'b').TrimEnd('=')
}

$projectId = 'lumina-crm'
$studio = Get-ContainerEnvironment "supabase_studio_$projectId"
$anonKey = $studio['SUPABASE_ANON_KEY']
$serviceKey = $studio['SUPABASE_SERVICE_KEY']
if (-not $anonKey -or -not $serviceKey) {
  throw 'The running local Supabase environment does not expose the required local development keys.'
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
function Set-Value([string]$Key, [string]$Value) { $values[$Key] = $Value }
function Set-Default([string]$Key, [string]$Value) {
  if (-not $values.Contains($Key) -or [string]::IsNullOrWhiteSpace([string]$values[$Key])) {
    $values[$Key] = $Value
  }
}

Set-Value 'NEXT_PUBLIC_SUPABASE_URL' 'http://127.0.0.1:56321'
Set-Value 'NEXT_PUBLIC_SUPABASE_ANON_KEY' $anonKey
Set-Value 'SUPABASE_SERVICE_ROLE_KEY' $serviceKey
Set-Value 'APP_URL' 'http://localhost:3200'
Set-Value 'NEXT_PUBLIC_TURNSTILE_SITE_KEY' '1x00000000000000000000AA'
Set-Value 'TURNSTILE_SECRET_KEY' '1x0000000000000000000000000000000AA'
Set-Value 'TURNSTILE_EXPECTED_HOSTNAME' 'localhost'
Set-Default 'CRM_WORKSPACE_ID' '00000000-0000-4000-8000-000000000001'
Set-Default 'LOGIN_THROTTLE_HASH_SECRET' (New-RandomSecret)

foreach ($key in @(
  'WEBHOOK_MICROSOFT_365_SECRET',
  'WEBHOOK_GOOGLE_CALENDAR_SECRET',
  'WEBHOOK_EMAIL_SECRET',
  'WEBHOOK_E_SIGNATURE_SECRET',
  'WEBHOOK_ACCOUNTING_SECRET'
)) { Set-Default $key (New-RandomSecret) }

foreach ($entry in @{
  OUTBOX_BATCH_SIZE = '20'
  CALENDAR_DELIVERY_BATCH_SIZE = '20'
  EXPORT_BATCH_SIZE = '10'
  REMINDER_BATCH_SIZE = '100'
  WEBHOOK_BATCH_SIZE = '20'
  INTEGRATION_SYNC_BATCH_SIZE = '10'
}.GetEnumerator()) { Set-Default $entry.Key $entry.Value }

foreach ($key in @(
  'EMAIL_DELIVERY_WEBHOOK_URL',
  'EMAIL_DELIVERY_WEBHOOK_TOKEN',
  'WEBHOOK_PROCESSOR_URL',
  'WEBHOOK_PROCESSOR_TOKEN',
  'INTEGRATION_SYNC_PROCESSOR_URL',
  'INTEGRATION_SYNC_PROCESSOR_TOKEN',
  'WORKER_ID'
)) { Set-Default $key '' }

Set-Default 'ADMIN_EMAIL' 'admin@lumina.local'
Set-Default 'ADMIN_PASSWORD' "L!9$(New-RandomSecret 18)"
Set-Default 'ADMIN_CHINESE_NAME' "$([char]0x7CFB)$([char]0x7EDF)$([char]0x7BA1)$([char]0x7406)$([char]0x5458)"
Set-Default 'ADMIN_ENGLISH_NAME' 'Lumina Administrator'
Set-Default 'ADMIN_USERNAME' 'lumina.admin'
Set-Default 'ADMIN_ROTATE_PASSWORD' 'true'

$lines = @(
  '# Generated for the isolated Lumina CRM Supabase stack. Existing and unknown keys are preserved.',
  '# External delivery and integration URLs remain blank until a real local adapter is configured.'
)
$lines += $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "Merged the isolated $projectId development environment without exposing secret values."
