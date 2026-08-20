# Run via WinRM FROM the laptop against the RX580 box, or locally ON the box.
# Recreates a healthy venv if needed, preinstalls torch + torch-directml, launches WebUI --api :7860.
#
# Laptop:
#   .\scripts\bootstrap-forge-box.ps1 -ComputerName 10.0.0.27 -User bot -Password '1'
# On box:
#   .\scripts\bootstrap-forge-box.ps1 -Local

param(
  [string]$ComputerName = '10.0.0.27',
  [string]$User = 'bot',
  [string]$Password = '1',
  [switch]$Local,
  [switch]$SkipLaunch
)

$script = {
  param([bool]$SkipLaunch)
  $ErrorActionPreference = 'Stop'
  $root = 'C:\AI\stable-diffusion-webui-amdgpu'
  $pySys = 'C:\Users\Bot\AppData\Local\Programs\Python\Python310\python.exe'
  if (-not (Test-Path $pySys)) { throw "Python 3.10 missing: $pySys" }
  if (-not (Test-Path $root)) { throw "Forge repo missing: $root — clone first (install-forge-rx580.ps1)" }

  New-Item -ItemType Directory -Force -Path C:\AI | Out-Null
  $venvPy = Join-Path $root 'venv\Scripts\python.exe'
  $needVenv = -not (Test-Path (Join-Path $root 'venv\Scripts\pip.exe'))
  if ($needVenv) {
    Write-Host 'Recreating venv…'
    if (Test-Path (Join-Path $root 'venv')) { Remove-Item -Recurse -Force (Join-Path $root 'venv') }
    & $pySys -m venv (Join-Path $root 'venv')
    & $venvPy -m pip install --upgrade pip setuptools wheel
  }

  # Ensure DirectML dep listed
  $req = Join-Path $root 'requirements_versions.txt'
  if ((Test-Path $req) -and ((Get-Content $req -Raw) -notmatch 'torch-directml')) {
    Add-Content $req "`ntorch-directml"
  }

  @"
@echo off
set PYTHON=$pySys
set GIT=C:\Users\Bot\AppData\Local\hermes\git\cmd\git.exe
set COMMANDLINE_ARGS=--api --listen --port 7860 --use-directml --medvram --opt-sub-quad-attention --opt-split-attention --no-half-vae --skip-torch-cuda-test --enable-insecure-extension-access
call webui.bat
"@ | Set-Content -Encoding ascii (Join-Path $root 'webui-user.bat')

  @"
@echo off
cd /d $root
echo ===== %date% %time% starting webui =====>> C:\AI\webui-launch.log
call webui-user.bat >> C:\AI\webui-launch.log 2>&1
"@ | Set-Content -Encoding ascii C:\AI\start-webui.cmd

  Write-Host 'Installing torch (CPU wheel) + torch-directml…'
  & $venvPy -m pip install --default-timeout=1000 `
    torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 `
    --index-url https://download.pytorch.org/whl/cpu
  & $venvPy -m pip install --default-timeout=1000 torch-directml

  & $venvPy -c "import torch; import torch_directml; print('torch', torch.__version__); print('dml', torch_directml.device())"

  if ($SkipLaunch) {
    Write-Host 'SkipLaunch set — not starting WebUI.'
    return
  }

  # Kill stale listeners on 7860
  Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

  Write-Host 'Launching WebUI (background)…'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c C:\AI\start-webui.cmd' -WorkingDirectory $root -WindowStyle Hidden
  Write-Host 'Started. Tail C:\AI\webui-launch.log ; probe http://127.0.0.1:7860/sdapi/v1/sd-models'
}

if ($Local) {
  & $script -SkipLaunch:$SkipLaunch
} else {
  $sec = ConvertTo-SecureString $Password -AsPlainText -Force
  $cred = New-Object PSCredential($User, $sec)
  Invoke-Command -ComputerName $ComputerName -Credential $cred -ScriptBlock $script -ArgumentList $SkipLaunch
}
