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
  Write-Host ""
  Write-Host "==> Starting Caprigo" -ForegroundColor Cyan
  & $npm run start
  if ($LASTEXITCODE -ne 0) { throw "npm run start failed." }
}
finally {
  Pop-Location
}
