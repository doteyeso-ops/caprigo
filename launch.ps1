Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-NpmCommand {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm was not found on PATH. Install Node.js 18+ first."
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = Get-NpmCommand

Push-Location $RepoRoot
try {
  if (-not $env:CAPRIGO_REQUEST_LOG) {
    $env:CAPRIGO_REQUEST_LOG = "smart"
  }

  Write-Host ""
  Write-Host "--------------------------------------------------------------" -ForegroundColor Cyan
  Write-Host "CAPRIGO" -ForegroundColor Cyan
  Write-Host "Local-first agent runtime" -ForegroundColor DarkGray
  Write-Host "Gateway startup with quieter routine logs" -ForegroundColor DarkGray
  Write-Host "--------------------------------------------------------------" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Starting gateway on http://127.0.0.1:18789" -ForegroundColor Cyan
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18789/health" -TimeoutSec 2
    if ($health.StatusCode -eq 200) {
      Write-Host "Gateway is already running on port 18789. Nothing to launch." -ForegroundColor Yellow
      return
    }
  }
  catch {
    # No healthy listener; continue with normal startup path.
  }

  & $npm run start
  if ($LASTEXITCODE -ne 0) { throw "npm run start failed." }
}
finally {
  Pop-Location
}
