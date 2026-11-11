# API keys for the Text Transcription API (/api/v1/transcribe), one per outside site.
# The key is made here, shown once, and only its SHA-256 goes to the database:
# keep it somewhere safe and give it to the other site's developer for their server.
#
#   .\tools\api-key.ps1 new  <name> [-Daily 10]   a new key for a site
#   .\tools\api-key.ps1 rotate <name>             a new key in place of the old one
#   .\tools\api-key.ps1 off  <name>               stop the site's key at once
#   .\tools\api-key.ps1 on   <name>               let it work again
#   .\tools\api-key.ps1 limit <name> -Daily 100   change its requests per 24 h
#   .\tools\api-key.ps1 list                      the sites, their limits and today's use
#
# Add -Local to work on the local database of `wrangler dev` instead of the live one.
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('new', 'rotate', 'off', 'on', 'limit', 'list')][string]$Action,
  [Parameter(Position = 1)][string]$Name,
  [int]$Daily = 10,
  [switch]$Local
)
$ErrorActionPreference = 'Stop'
$where = if ($Local) { '--local' } else { '--remote' }
$db = if ($Local) { 'DB' } else { 'studyzone-db' }   # locally by its binding: wrangler.jsonc gives it no name
$worker = Join-Path $PSScriptRoot '..\worker'

function Run-Sql([string]$sql) {
  Push-Location $worker
  try { npx.cmd wrangler d1 execute $db $where --command $sql }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "wrangler failed" }
}
# rotate, off, on and limit work on a site that has a key; any other name stops here
function Assert-Site {
  Push-Location $worker
  try { $j = (npx.cmd wrangler d1 execute $db $where --json --command "SELECT name FROM api_keys WHERE name='$Name';" 2>$null) -join "`n" }
  finally { Pop-Location }
  $rows = @(($j | ConvertFrom-Json)[0].results)
  if ($rows.Count -eq 0) { Write-Host "No key for '${Name}'. Make one with: .\tools\api-key.ps1 new ${Name}" -ForegroundColor Red; exit 1 }
}

if ($Action -ne 'list' -and $Name -notmatch '^[a-z0-9-]{2,40}$') { throw "The name is 2-40 of a-z, 0-9 and -, like: my-site" }
if ($Daily -lt 1 -or $Daily -gt 10000) { throw "-Daily is 1 to 10000" }

$table = "CREATE TABLE IF NOT EXISTS api_keys (name TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, daily_max INTEGER NOT NULL DEFAULT 10, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));"

function New-Key {
  # 32 random bytes, as letters and digits: hct_ and 43 characters
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = 'hct_' + ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B'))
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($key))
  return @{ key = $key; hash = (-join ($sha | ForEach-Object { $_.ToString('x2') })) }
}
function Show-Key($k, [string]$what) {
  # ASCII only: Windows PowerShell reads this file in the system code page
  Write-Host ""
  Write-Host "$what for '${Name}'. It is shown only now:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  $($k.key)"
  Write-Host ""
}

if (@('rotate', 'off', 'on', 'limit') -contains $Action) { Assert-Site }

switch ($Action) {
  'new' {
    $k = New-Key
    try { Run-Sql "$table INSERT INTO api_keys (name, hash, daily_max) VALUES ('$Name', '$($k.hash)', $Daily);" | Out-Null }
    catch { Write-Host "'${Name}' already has a key. For a new key in its place: .\tools\api-key.ps1 rotate ${Name}" -ForegroundColor Red; exit 1 }
    Show-Key $k "The key ($Daily requests per 24 h)"
  }
  'rotate' {
    # a new key in place of the old one, which stops working at once; the limit stays
    $k = New-Key
    Run-Sql "UPDATE api_keys SET hash='$($k.hash)', active=1 WHERE name='$Name';" | Out-Null
    Show-Key $k "The new key (the old one no longer works)"
  }
  'off'   { Run-Sql "UPDATE api_keys SET active=0 WHERE name='$Name';" }
  'on'    { Run-Sql "UPDATE api_keys SET active=1 WHERE name='$Name';" }
  'limit' { Run-Sql "UPDATE api_keys SET daily_max=$Daily WHERE name='$Name';" }
  'list'  {
    Run-Sql ("SELECT k.name, k.daily_max, k.active, k.created_at, (SELECT COUNT(*) FROM ai_usage u WHERE u.email='api:' || k.name AND u.kind='api-transcribe' AND u.at > datetime('now','-1 day')) AS used_24h FROM api_keys k ORDER BY k.name;")
  }
}
