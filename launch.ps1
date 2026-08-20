# Caprigo daily launcher — embedded CLI HUD (default product).
# Delegates to launch-hud.ps1. Pass -Rebuild to refresh agent + cli builds.

param(
  [switch]$Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HudScript = Join-Path $RepoRoot "launch-hud.ps1"

if (-not (Test-Path $HudScript)) {
  throw "Missing launch-hud.ps1 at $HudScript"
}

$args = @()
if ($Rebuild) { $args += "-Rebuild" }

& $HudScript @args
exit $LASTEXITCODE
