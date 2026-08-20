# Start Caprigo gateway detached (survives SSH / console close).
param(
  [string]$Root = 'C:\Users\box\caprigo'
)
$ErrorActionPreference = 'Continue'

# Free RAM: stray llama.cpp servers starve Ollama on 16GB UMA.
Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping zombie llama-server pid $($_.Id)"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

$env:Path = "C:\Program Files\nodejs;C:\Program Files\Ollama;$env:LOCALAPPDATA\Programs\Ollama;" + $env:Path
$env:CAPRIGO_BOX_PROFILE = '1'
$env:OLLAMA_VULKAN = '1'
$env:OLLAMA_IGPU_ENABLE = '1'
$env:OLLAMA_HOST = '127.0.0.1:11434'

if (-not (Test-Path $Root)) { throw "Caprigo root missing: $Root" }
if (-not (Test-Path (Join-Path $Root '.env')) -and (Test-Path (Join-Path $Root 'deploy\box-mini\.env.box'))) {
  Copy-Item (Join-Path $Root 'deploy\box-mini\.env.box') (Join-Path $Root '.env') -Force
}

# Ensure Ollama
try {
  $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2
} catch {
  $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $ollama) {
    Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden
    Start-Sleep 4
  }
}

# Already up?
try {
  $null = Invoke-RestMethod 'http://127.0.0.1:18789/health' -TimeoutSec 2
  Write-Host 'Gateway already healthy on :18789'
  exit 0
} catch {}

# Stop previous Caprigo node gateways (best-effort)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*packages\gateway\dist\index.js*' -or $_.CommandLine -like '*packages/gateway/dist/index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$logDir = Join-Path $env:USERPROFILE 'llm-bench'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'caprigo-gw.out'
$errLog = Join-Path $logDir 'caprigo-gw.err'
$node = (Get-Command node.exe).Source
$gw = Join-Path $Root 'packages\gateway\dist\index.js'

# Wrapper .cmd avoids schtasks quoting hell with env vars
$wrap = Join-Path $logDir 'caprigo-gw-run.cmd'
@(
  '@echo off'
  "set CAPRIGO_BOX_PROFILE=1"
  "set OLLAMA_VULKAN=1"
  "set OLLAMA_IGPU_ENABLE=1"
  "set OLLAMA_HOST=127.0.0.1:11434"
  "cd /d `"$Root`""
  "`"$node`" `"$gw`" >> `"$outLog`" 2>> `"$errLog`""
) | Set-Content -Encoding ascii $wrap

$task = 'CaprigoGateway'
cmd /c "schtasks /Delete /TN $task /F >nul 2>&1"
$createOut = cmd /c "schtasks /Create /TN $task /SC ONCE /ST 00:00 /RL LIMITED /F /TR `"$wrap`""
if ($LASTEXITCODE -ne 0) {
  Write-Host $createOut
  Write-Host 'schtasks create failed — Win32_Process fallback'
  $null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine     = "`"$wrap`""
    CurrentDirectory = $Root
  }
} else {
  cmd /c "schtasks /Run /TN $task" | Out-Null
}

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep 1
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:18789/health' -TimeoutSec 2
    $ok = $true
    Write-Host "Gateway OK skills=$($h.skills) llm=$($h.llm.ollama)"
    break
  } catch {}
}
if (-not $ok) {
  Write-Host 'Gateway failed to start. Tail:'
  Get-Content $errLog -Tail 40 -ErrorAction SilentlyContinue
  Get-Content $outLog -Tail 40 -ErrorAction SilentlyContinue
  exit 1
}
