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

$projectId = 'lumina-crm'
$studioContainer = "supabase_studio_$projectId"
$studio = Get-ContainerEnvironment $studioContainer
$anonKey = $studio['SUPABASE_ANON_KEY']
$serviceKey = $studio['SUPABASE_SERVICE_KEY']
if (-not $anonKey -or -not $serviceKey) {
  throw 'The running local Supabase environment does not expose the required local development keys.'
}

$bytes = New-Object byte[] 18
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$randomPart = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'b').TrimEnd('=')
$adminPassword = "L!9$randomPart"

$lines = @(
  '# Generated for the isolated Lumina CRM Supabase stack. Ignored by Git.',
  'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321',
  'APP_URL=http://localhost:3200',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA',
  'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=$anonKey",
  "SUPABASE_SERVICE_ROLE_KEY=$serviceKey",
  'ADMIN_EMAIL=admin@lumina.local',
  "ADMIN_PASSWORD=$adminPassword",
  "ADMIN_CHINESE_NAME=$([char]0x7CFB)$([char]0x7EDF)$([char]0x7BA1)$([char]0x7406)$([char]0x5458)",
  'ADMIN_ENGLISH_NAME=Lumina Administrator',
  'ADMIN_USERNAME=lumina.admin',
  'ADMIN_ROTATE_PASSWORD=true'
)

[System.IO.File]::WriteAllLines((Join-Path $PWD '.env.local'), $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "Configured the isolated $projectId Supabase development environment without exposing secret values."
