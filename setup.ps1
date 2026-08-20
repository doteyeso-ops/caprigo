param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipInteractiveSetup,
  [switch]$LaunchHud,
  [switch]$NoLaunch
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
$SetupArgs = @('setup', '--interactive', '--no-launch')

if ($LaunchHud -and $NoLaunch) {
  throw "Use either -LaunchHud or -NoLaunch, not both."
}

Push-Location $RepoRoot
try {
  if (-not $SkipInstall) {
    Write-Step "Installing dependencies"
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }

  if (-not $SkipBuild) {
    Write-Step "Building Caprigo CLI harness"
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
  }

  if (-not $SkipInteractiveSetup) {
    Write-Step "Starting guided Caprigo setup"
    & node "packages\cli\dist\index.js" @SetupArgs
    if ($LASTEXITCODE -ne 0) { throw "Interactive setup failed." }
  } else {
    Write-Step "Skipping guided setup"
  }

  if ($LaunchHud) {
    Write-Step "Launching CLI HUD"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $RepoRoot "launch-hud.ps1")
    if ($LASTEXITCODE -ne 0) { throw "HUD launch failed." }
  }

  Write-Host ""
  Write-Host "Caprigo setup finished." -ForegroundColor Green
  Write-Host "Repo: $RepoRoot"
  Write-Host "Daily path: .\launch-hud.ps1  (or .\launch.ps1)"
  Write-Host "Next: start LM Studio, load a tool model, then launch the HUD."
}
finally {
  Pop-Location
}
