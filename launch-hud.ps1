# Caprigo HUD launcher — always runs the current packages/cli/dist build.
# Usage:
#   .\launch-hud.ps1
#   .\launch-hud.ps1 -Rebuild   # rebuild @caprigo/agent + @caprigo/cli first

param(
  [switch]$Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CliEntry = Join-Path $RepoRoot 'packages\cli\dist\index.js'
$AgentEntry = Join-Path $RepoRoot 'packages\agent\dist\index.js'
$DesktopPs1 = Join-Path $RepoRoot 'packages\agent\dist\skills\desktop-win.ps1'

Set-Location $RepoRoot

$needBuild = $Rebuild -or -not (Test-Path $CliEntry) -or -not (Test-Path $AgentEntry) -or -not (Test-Path $DesktopPs1)
if ($needBuild) {
  Write-Host '[Caprigo] Building agent (desktop/OCR skills)...' -ForegroundColor Cyan
  npm run build -w @caprigo/agent
  if ($LASTEXITCODE -ne 0) { throw 'Agent build failed' }
  Write-Host '[Caprigo] Building CLI...' -ForegroundColor Cyan
  npm run build -w @caprigo/cli
  if ($LASTEXITCODE -ne 0) { throw 'CLI build failed' }
}

Write-Host '[Caprigo] Launching HUD...' -ForegroundColor Cyan
node $CliEntry tui
exit $LASTEXITCODE
