# Run ON the RX580 box (10.0.0.27), not the laptop.
# Installs SD WebUI Forge (DirectML/AMD) + SD 1.5 and prepares --api on :7860.
# Caprigo (laptop) should then set:
#   CAPRIGO_IMAGE_PROVIDER=a1111
#   CAPRIGO_IMAGE_BASE_URL=http://10.0.0.27:7860
#
# Prefer laptop-driven finish:  .\scripts\bootstrap-forge-box.ps1
# (recreates venv, pip installs torch+directml, launches WebUI)

$ErrorActionPreference = 'Stop'
$InstallRoot = if ($env:CAPRIGO_FORGE_ROOT) { $env:CAPRIGO_FORGE_ROOT } else { 'C:\AI\stable-diffusion-webui-amdgpu' }
$Repo = 'https://github.com/lshqqytiger/stable-diffusion-webui-amdgpu.git'
$ModelDir = Join-Path $InstallRoot 'models\Stable-diffusion'
$ModelUrl = 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly.safetensors'
$ModelFile = Join-Path $ModelDir 'v1-5-pruned-emaonly.safetensors'

Write-Host "Install root: $InstallRoot"
if (-not (Test-Path $InstallRoot)) {
  git clone $Repo $InstallRoot
} else {
  Write-Host 'Repo already present — pulling…'
  Push-Location $InstallRoot
  git pull --ff-only
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null
if (-not (Test-Path $ModelFile)) {
  Write-Host 'Downloading SD 1.5 (~4GB)…'
  curl.exe -L --retry 3 -o $ModelFile $ModelUrl
} else {
  Write-Host 'SD 1.5 already on disk.'
}

$req = Join-Path $InstallRoot 'requirements_versions.txt'
if ((Test-Path $req) -and ((Get-Content $req -Raw) -notmatch 'torch-directml')) {
  Add-Content $req "`ntorch-directml"
  Write-Host 'Appended torch-directml to requirements_versions.txt'
}

$WebuiUser = Join-Path $InstallRoot 'webui-user.bat'
@"
@echo off
set COMMANDLINE_ARGS=--api --listen --port 7860 --use-directml --medvram --opt-sub-quad-attention --opt-split-attention --no-half-vae --skip-torch-cuda-test --enable-insecure-extension-access
call webui.bat
"@ | Set-Content -Encoding ascii $WebuiUser

New-Item -ItemType Directory -Force -Path 'C:\AI' | Out-Null
@"
@echo off
cd /d $InstallRoot
echo ===== %date% %time% starting webui =====>> C:\AI\webui-launch.log
call webui-user.bat >> C:\AI\webui-launch.log 2>&1
"@ | Set-Content -Encoding ascii 'C:\AI\start-webui.cmd'

Write-Host @"

Next (recommended from laptop):
  .\scripts\bootstrap-forge-box.ps1
  # or on box: first webui.bat run is long (torch + deps)

Confirm: http://10.0.0.27:7860/sdapi/v1/sd-models
Laptop .env:
  CAPRIGO_IMAGE_PROVIDER=a1111
  CAPRIGO_IMAGE_BASE_URL=http://10.0.0.27:7860

RX 580 ~8GB: stick to SD 1.5 / turbo SDXL. Do not use Flux.
"@
