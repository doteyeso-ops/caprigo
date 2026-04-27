param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipWebBuild,
  [switch]$SkipInteractiveSetup,
  [switch]$Launch,
  [switch]$NoLaunch,
  [switch]$OpenBrowser,
  [switch]$NoOpenBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-NpmCommand {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm was not found on PATH. Install Node.js 18+ first."
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = Get-NpmCommand
$SetupArgs = @('setup', '--interactive')

if ($Launch -and $NoLaunch) {
  throw "Use either -Launch or -NoLaunch, not both."
}
if ($OpenBrowser -and $NoOpenBrowser) {
  throw "Use either -OpenBrowser or -NoOpenBrowser, not both."
}
if ($Launch) { $SetupArgs += '--launch' }
if ($NoLaunch) { $SetupArgs += '--no-launch' }
if ($OpenBrowser) { $SetupArgs += '--open-browser' }
if ($NoOpenBrowser) { $SetupArgs += '--no-open-browser' }

Push-Location $RepoRoot
try {
  if (-not $SkipInstall) {
    Write-Step "Installing dependencies"
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }

  if (-not $SkipBuild) {
    Write-Step "Building Caprigo packages"
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  }

  if (-not $SkipWebBuild) {
    Write-Step "Building web app"
    & $npm run build:web
    if ($LASTEXITCODE -ne 0) { throw "npm run build:web failed." }
  }

  if (-not $SkipInteractiveSetup) {
    Write-Step "Starting guided Caprigo setup"
    & node "packages\cli\dist\index.js" @SetupArgs
    if ($LASTEXITCODE -ne 0) { throw "Interactive setup failed." }
  } else {
    Write-Step "Skipping guided setup"
  }

  Write-Host ""
  Write-Host "Caprigo setup wrapper finished." -ForegroundColor Green
  Write-Host "Repo: $RepoRoot"
  Write-Host "Overview: http://127.0.0.1:18789"
  Write-Host "Next: confirm backend/model on Overview, then create the first agent."
}
finally {
  Pop-Location
}
