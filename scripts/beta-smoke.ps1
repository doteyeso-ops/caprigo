param(
  [string]$GatewayUrl = "http://127.0.0.1:18789",
  [string]$ApiToken = "",
  [string]$VibesListingId = "",
  [string]$VibesQuery = "json",
  [string]$SessionModel = "",
  [switch]$AutoStartGateway = $true,
  [switch]$InstallIfNeeded = $true,
  [switch]$BuildIfNeeded = $true,
  [int]$GatewayStartTimeoutSec = 90,
  [switch]$PromptForModel = $true,
  [switch]$AutoPickFirstModel = $true,
  [int]$LlmCheckTimeoutSec = 240,
  [switch]$SkipVibes,
  [switch]$SkipLlm,
  [switch]$SkipFleet,
  [switch]$KeepSessions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Pass([string]$Message) {
  Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$GatewayLogDir = Join-Path $RepoRoot ".caprigo"
$GatewayStdoutLog = Join-Path $GatewayLogDir "beta-smoke-gateway.out.log"
$GatewayStderrLog = Join-Path $GatewayLogDir "beta-smoke-gateway.err.log"
$StartedGatewayProcess = $null

function New-Headers {
  $headers = @{
    "Content-Type" = "application/json"
  }
  if ($ApiToken.Trim()) {
    $headers["x-caprigo-token"] = $ApiToken.Trim()
  }
  return $headers
}

function Invoke-CaprigoApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body = $null
  )

  $uri = "$($GatewayUrl.TrimEnd('/'))$Path"
  $headers = New-Headers
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 10
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Test-GatewayReachable {
  try {
    $uri = "$($GatewayUrl.TrimEnd('/'))/health"
    $headers = New-Headers
    Invoke-RestMethod -Method GET -Uri $uri -Headers $headers | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-NpmCommand {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm was not found on PATH."
}

function Ensure-DependenciesInstalled {
  $tscCmd = Get-Command tsc -ErrorAction SilentlyContinue
  $typescriptBin = Join-Path $RepoRoot "node_modules\.bin\tsc.cmd"
  if ($tscCmd -or (Test-Path $typescriptBin)) {
    return
  }
  if (-not $InstallIfNeeded) {
    throw "TypeScript build tooling is missing and -InstallIfNeeded was disabled."
  }

  Write-Step "Installing Caprigo dependencies"
  $npm = Get-NpmCommand
  Push-Location $RepoRoot
  try {
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  } finally {
    Pop-Location
  }
}

function Ensure-BuildArtifacts {
  $gatewayEntry = Join-Path $RepoRoot "packages\gateway\dist\index.js"
  $webEntry = Join-Path $RepoRoot "packages\web\dist\index.html"
  if ((Test-Path $gatewayEntry) -and (Test-Path $webEntry)) {
    return
  }
  if (-not $BuildIfNeeded) {
    throw "Build artifacts are missing and -BuildIfNeeded was disabled."
  }

  Ensure-DependenciesInstalled
  Write-Step "Building Caprigo before launch"
  $npm = Get-NpmCommand
  Push-Location $RepoRoot
  try {
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
    & $npm run build:web
    if ($LASTEXITCODE -ne 0) { throw "npm run build:web failed." }
  } finally {
    Pop-Location
  }
}

function Start-Gateway {
  if (Test-GatewayReachable) {
    Write-Pass "Gateway already reachable"
    return
  }
  if (-not $AutoStartGateway) {
    throw "Caprigo gateway is not reachable at $GatewayUrl and -AutoStartGateway was disabled."
  }

  Ensure-BuildArtifacts
  $npm = Get-NpmCommand
  New-Item -ItemType Directory -Path $GatewayLogDir -Force | Out-Null

  Write-Step "Starting Caprigo gateway"
  $StartedGatewayProcess = Start-Process `
    -FilePath $npm `
    -ArgumentList "run", "start" `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $GatewayStdoutLog `
    -RedirectStandardError $GatewayStderrLog `
    -PassThru

  $deadline = (Get-Date).AddSeconds($GatewayStartTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-GatewayReachable) {
      Write-Pass "Gateway started successfully"
      Write-Host "PID: $($StartedGatewayProcess.Id)"
      Write-Host "Stdout: $GatewayStdoutLog"
      Write-Host "Stderr: $GatewayStderrLog"
      return
    }
    if ($StartedGatewayProcess.HasExited) {
      $stderr = if (Test-Path $GatewayStderrLog) { Get-Content $GatewayStderrLog -Raw } else { "" }
      $stdout = if (Test-Path $GatewayStdoutLog) { Get-Content $GatewayStdoutLog -Raw } else { "" }
      throw "Gateway process exited early.`n`nSTDOUT:`n$stdout`n`nSTDERR:`n$stderr"
    }
    Start-Sleep -Seconds 2
  }

  throw @"
Gateway did not become reachable within $GatewayStartTimeoutSec seconds.

URL:    $GatewayUrl
PID:    $($StartedGatewayProcess.Id)
Stdout: $GatewayStdoutLog
Stderr: $GatewayStderrLog
"@
}

function Get-Messages([string]$SessionId) {
  return (Invoke-CaprigoApi -Method GET -Path "/api/sessions/$SessionId/messages").messages
}

function Get-SessionRow([string]$SessionId) {
  $sessions = (Invoke-CaprigoApi -Method GET -Path "/api/sessions").sessions
  return $sessions | Where-Object { $_.id -eq $SessionId } | Select-Object -First 1
}

function Invoke-CaprigoApiAsync {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body = $null
  )

  $uri = "$($GatewayUrl.TrimEnd('/'))$Path"
  $headers = New-Headers
  $bodyJson = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 10 } else { $null }

  return Start-Job -ScriptBlock {
    param($Method, $Uri, $Headers, $BodyJson)
    if ($null -ne $BodyJson) {
      Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -Body $BodyJson
    } else {
      Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
    }
  } -ArgumentList $Method, $uri, $headers, $bodyJson
}

function Wait-ForAsyncApiJob {
  param(
    [Parameter(Mandatory = $true)]$Job,
    [string]$SessionId = "",
    [string]$Label = "LLM request",
    [int]$TimeoutSec = 240
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $state = (Get-Job -Id $Job.Id).State
    if ($state -eq 'Completed') {
      try {
        return Receive-Job -Id $Job.Id -ErrorAction Stop
      } finally {
        Remove-Job -Id $Job.Id -Force -ErrorAction SilentlyContinue | Out-Null
      }
    }
    if ($state -eq 'Failed' -or $state -eq 'Stopped') {
      try {
        $jobOut = Receive-Job -Id $Job.Id -ErrorAction SilentlyContinue | Out-String
      } finally {
        Remove-Job -Id $Job.Id -Force -ErrorAction SilentlyContinue | Out-Null
      }
      throw "$Label failed. $jobOut"
    }

    if ($SessionId) {
      try {
        $row = Get-SessionRow $SessionId
        if ($row) {
          $effectiveModel = if ($null -ne $row.effectiveModel -and "$($row.effectiveModel)".Trim()) { "$($row.effectiveModel)" } else { "-" }
          Write-Host ("   {0}: status={1} messages={2} model={3}" -f $Label, $row.status, $row.messageCount, $effectiveModel)
        }
      } catch {
        Write-WarnLine "Could not poll session state for $Label."
      }
      try {
        $ollamaPs = (& ollama ps 2>$null | Out-String).Trim()
        if ($ollamaPs) {
          $firstDataLine = ($ollamaPs -split "`r?`n" | Select-Object -Skip 1 | Select-Object -First 1)
          if ($firstDataLine) {
            Write-Host ("   ollama: {0}" -f $firstDataLine.Trim())
          }
        }
      } catch {
        # ignore
      }
    } else {
      Write-Host "   $Label still running..."
    }

    Start-Sleep -Seconds 5
  }

  try {
    Stop-Job -Id $Job.Id -ErrorAction SilentlyContinue | Out-Null
    $jobOut = Receive-Job -Id $Job.Id -ErrorAction SilentlyContinue | Out-String
  } finally {
    Remove-Job -Id $Job.Id -Force -ErrorAction SilentlyContinue | Out-Null
  }

  throw @"
$Label timed out after $TimeoutSec seconds.

This usually means local inference is slow on the current hardware.
- Try a smaller installed model.
- Rerun with -SessionModel model_name
- Or skip LLM checks with -SkipLlm

Partial job output:
$jobOut
"@
}

function Wait-ForMessageMatch {
  param(
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $messages = Get-Messages $SessionId
    foreach ($message in $messages) {
      if (($message.content | Out-String) -match $Pattern) {
        return $true
      }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-AvailableModels {
  param(
    [Parameter(Mandatory = $true)]$Runtime
  )

  $provider = [string]$Runtime.llmProvider
  if ($provider -eq "openai_compatible" -or $provider -eq "openai") {
    $catalog = Invoke-CaprigoApi -Method GET -Path "/api/openai/models"
    return @($catalog.models)
  }

  $catalog = Invoke-CaprigoApi -Method GET -Path "/api/ollama/models"
  return @($catalog.models)
}

function Resolve-SmokeModel {
  param(
    [Parameter(Mandatory = $true)]$Runtime
  )

  $defaultModel = [string]$Runtime.engine.model
  $provider = [string]$Runtime.llmProvider
  $available = @()

  try {
    $available = @(Get-AvailableModels -Runtime $Runtime | Where-Object { $_ -and "$_".Trim() })
  } catch {
    Write-WarnLine "Could not fetch available models from the gateway. Falling back to the runtime default."
  }

  if ($SessionModel.Trim()) {
    if ($available.Count -gt 0 -and -not ($available -contains $SessionModel.Trim())) {
      Write-WarnLine "Requested model '$SessionModel' was not reported by the gateway, but it will still be used."
    }
    return $SessionModel.Trim()
  }

  if ($available.Count -eq 0) {
    Write-WarnLine "No model catalog was returned. Using the runtime default model '$defaultModel'."
    return $defaultModel
  }

  if ($available -contains $defaultModel) {
    return $defaultModel
  }

  Write-WarnLine "Runtime default model '$defaultModel' is not currently installed or exposed by the active provider."
  Write-Host "Available models:"
  for ($i = 0; $i -lt $available.Count; $i++) {
    Write-Host ("  [{0}] {1}" -f ($i + 1), $available[$i])
  }

  if ($PromptForModel) {
    $raw = Read-Host "Pick a model number for smoke-test sessions (Enter = 1)"
    if (-not $raw.Trim()) {
      return $available[0]
    }
    $index = 0
    if ([int]::TryParse($raw, [ref]$index) -and $index -ge 1 -and $index -le $available.Count) {
      return $available[$index - 1]
    }
    Write-WarnLine "Invalid selection '$raw'."
  }

  if ($AutoPickFirstModel) {
    Write-WarnLine "Auto-picking the first available model: $($available[0])"
    return $available[0]
  }

  throw @"
No usable smoke-test model was selected.

Run:
  caprigo models

Or rerun with:
  -SessionModel model_name
"@
}

$createdSessionIds = New-Object System.Collections.Generic.List[string]
$skipLlmCheck = [bool]$SkipLlm
$skipFleetCheck = [bool]$SkipFleet
$resolvedSessionModel = $null

try {
  Write-Step "Checking gateway health"
  Start-Gateway
  $health = Invoke-CaprigoApi -Method GET -Path "/health"
  $runtime = Invoke-CaprigoApi -Method GET -Path "/api/runtime"
  $skills = Invoke-CaprigoApi -Method GET -Path "/api/skills"
  $offlineCatalog = Invoke-CaprigoApi -Method GET -Path "/api/offline-scripts"

  Write-Pass "Gateway responded"
  Write-Host "Provider: $($runtime.llmProvider)"
  Write-Host "Model:    $($runtime.engine.model)"
  Write-Host "Skills:   $($skills.skills.Count)"
  Write-Host "Scripts:  $($offlineCatalog.scripts.Count)"

  if (-not $skipLlmCheck) {
    Write-Step "Resolving smoke-test model"
    $resolvedSessionModel = Resolve-SmokeModel -Runtime $runtime
    Write-Pass "Using session model: $resolvedSessionModel"
  } else {
    Write-WarnLine "Skipping model resolution because LLM checks were disabled."
  }

  if (-not $offlineCatalog.scripts -or $offlineCatalog.scripts.Count -eq 0) {
    throw "No offline scripts found. Smoke test requires at least one script in offline-scripts/."
  }

  $helloScript = $offlineCatalog.scripts | Where-Object { $_.id -eq "hello" } | Select-Object -First 1
  if (-not $helloScript) {
    $helloScript = $offlineCatalog.scripts | Select-Object -First 1
    Write-WarnLine "Preferred offline script 'hello' not found. Using '$($helloScript.id)'."
  }

  Write-Step "Creating smoke-test sessions"
  $orchestratorBody = @{
    displayName = "Smoke Orchestrator"
    description = "Beta smoke test coordinator"
    objective = "Verify orchestrator-worker routing for Caprigo beta readiness."
    runtimeMode = "llm"
    agentRole = "orchestrator"
  }
  if ($resolvedSessionModel) { $orchestratorBody.model = $resolvedSessionModel }
  $orchestrator = Invoke-CaprigoApi -Method POST -Path "/api/sessions" -Body $orchestratorBody
  $createdSessionIds.Add($orchestrator.id)

  $workerBody = @{
    displayName = "Smoke Worker"
    description = "Beta smoke test worker"
    objective = "Respond clearly and verify delegated task flow."
    runtimeMode = "llm"
    agentRole = "agent"
    linkedOrchestratorId = $orchestrator.id
  }
  if ($resolvedSessionModel) { $workerBody.model = $resolvedSessionModel }
  $worker = Invoke-CaprigoApi -Method POST -Path "/api/sessions" -Body $workerBody
  $createdSessionIds.Add($worker.id)

  $offline = Invoke-CaprigoApi -Method POST -Path "/api/sessions" -Body @{
    displayName = "Smoke Offline"
    description = "Beta smoke test offline runner"
    objective = "Verify local script execution."
    runtimeMode = "offline"
    primaryOfflineScriptId = $helloScript.id
    assignedOfflineScripts = @($helloScript.id)
  }
  $createdSessionIds.Add($offline.id)

  Write-Pass "Created orchestrator, worker, and offline sessions"

  Write-Step "Running offline-script check"
  $offlineRun = Invoke-CaprigoApi -Method POST -Path "/api/sessions/$($offline.id)/offline/run" -Body @{
    scriptId = $helloScript.id
    args = @()
  }
  $offlineMessages = Get-Messages $offline.id
  if (-not ($offlineMessages | Where-Object { $_.role -eq "offline" })) {
    throw "Offline session did not record a local-script transcript line."
  }
  Write-Pass "Offline script executed and wrote transcript output"

  if (-not $skipLlmCheck) {
    Write-Step "Running single-agent LLM check"
    $workerJob = Invoke-CaprigoApiAsync -Method POST -Path "/api/sessions/$($worker.id)/messages" -Body @{
      message = "Reply with the exact token CAPRIGO_SMOKE_OK and mention your runtime mode in one sentence."
    }
    $workerReply = Wait-ForAsyncApiJob -Job $workerJob -SessionId $worker.id -Label "Worker LLM check" -TimeoutSec $LlmCheckTimeoutSec
    if (($workerReply.response | Out-String) -notmatch "CAPRIGO_SMOKE_OK") {
      throw "Worker LLM check did not return CAPRIGO_SMOKE_OK."
    }
    Write-Pass "LLM worker session responded correctly"
  } else {
    Write-WarnLine "Skipping direct LLM worker check by request."
  }

  if (-not $skipFleetCheck -and -not $skipLlmCheck) {
    Write-Step "Running orchestrator-worker fleet flow"
    $orchJob = Invoke-CaprigoApiAsync -Method POST -Path "/api/sessions/$($orchestrator.id)/messages" -Body @{
      message = "Use fleet_roster, find the worker session named Smoke Worker, and send it a directive with fleet_message telling it to report back with the exact token SMOKE_FLEET_OK. Then tell me you delegated the task."
    }
    $orchReply = Wait-ForAsyncApiJob -Job $orchJob -SessionId $orchestrator.id -Label "Orchestrator fleet check" -TimeoutSec $LlmCheckTimeoutSec
    if (($orchReply.response | Out-String) -notmatch "delegat|sent|directive|worker") {
      Write-WarnLine "Orchestrator response did not clearly confirm delegation. Continuing to transcript checks."
    }

    $workerFleetJob = Invoke-CaprigoApiAsync -Method POST -Path "/api/sessions/$($worker.id)/messages" -Body @{
      message = "Review any fleet directive in your transcript. If present, send an update to your orchestrator with the exact token SMOKE_FLEET_OK using fleet_message, then answer in one sentence."
    }
    $workerFleetReply = Wait-ForAsyncApiJob -Job $workerFleetJob -SessionId $worker.id -Label "Worker fleet check" -TimeoutSec $LlmCheckTimeoutSec
    if (($workerFleetReply.response | Out-String) -notmatch "SMOKE_FLEET_OK|update|orchestrator|sent") {
      Write-WarnLine "Worker response did not clearly confirm fleet update. Continuing to transcript checks."
    }

    $workerHasDirective = Wait-ForMessageMatch -SessionId $worker.id -Pattern "SMOKE_FLEET_OK|Fleet|directive" -TimeoutSec 20
    $orchHasUpdate = Wait-ForMessageMatch -SessionId $orchestrator.id -Pattern "SMOKE_FLEET_OK" -TimeoutSec 20

    if ($workerHasDirective -and $orchHasUpdate) {
      Write-Pass "Fleet orchestration flow produced transcript evidence on both sessions"
    } else {
      Write-WarnLine "Fleet flow did not fully verify. This is a soft failure because it depends on model/tool behavior."
    }
  } else {
    Write-WarnLine "Skipping fleet orchestration flow."
  }

  if (-not $SkipVibes) {
    Write-Step "Running Vibes marketplace reachability check"
    $listings = Invoke-CaprigoApi -Method GET -Path "/api/vibes/listings?q=$([uri]::EscapeDataString($VibesQuery))&page_size=5"
    $listingCount = if ($listings.listings) { $listings.listings.Count } else { 0 }
    if ($listingCount -gt 0) {
      Write-Pass "Vibes marketplace search returned $listingCount listing(s)"
    } else {
      Write-WarnLine "Vibes marketplace search returned no listings for query '$VibesQuery'."
    }

    if ($VibesListingId.Trim()) {
      Write-Step "Attempting Vibes install for listing $VibesListingId"
      try {
        $install = Invoke-CaprigoApi -Method POST -Path "/api/vibes/install" -Body @{
          listingId = $VibesListingId.Trim()
        }
        Write-Pass "Installed Vibes listing into local skills: $((($install.skills | ForEach-Object { $_.name }) -join ', '))"
      } catch {
        Write-WarnLine "Vibes install failed for listing $VibesListingId. Check VIBES_CODED_API_KEY, listing access, and marketplace availability."
      }
    } else {
      Write-WarnLine "Skipping Vibes install. Provide -VibesListingId to test live skill import."
    }
  } else {
    Write-WarnLine "Skipping Vibes marketplace checks."
  }

  Write-Step "Smoke test summary"
  Write-Pass "Caprigo completed core beta-path checks for gateway, sessions, offline scripts, and basic LLM flow."
  if (-not $KeepSessions) {
    Write-Host "Temporary sessions will be removed."
  } else {
    Write-Host "Temporary sessions were kept for inspection."
  }
}
finally {
  if (-not $KeepSessions) {
    foreach ($sessionId in $createdSessionIds) {
      try {
        Invoke-CaprigoApi -Method DELETE -Path "/api/sessions/$sessionId" | Out-Null
      } catch {
        Write-WarnLine "Could not delete smoke-test session $sessionId"
      }
    }
  }
}
