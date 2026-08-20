# Caprigo box-mini deploy — simpler sync of built packages + install on box
param(
  [string]$Remote = 'box@10.0.0.13',
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519"
)
$ErrorActionPreference = 'Stop'
$Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Write-Host "Building locally in $Repo"
Push-Location $Repo
npm run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
Pop-Location

$stage = Join-Path $env:TEMP 'caprigo-box-upload'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$copyList = @(
  'package.json',
  'package-lock.json',
  'deploy\box-mini',
  'offline-scripts',
  'skills',
  'packages\shared',
  'packages\ollama-client',
  'packages\chat-backend',
  'packages\user-skills-loader',
  'packages\agent',
  'packages\gateway',
  'packages\cli'
)
foreach ($item in $copyList) {
  $src = Join-Path $Repo $item
  $dst = Join-Path $stage $item
  if (-not (Test-Path $src)) { Write-Host "skip missing $item"; continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  if (Test-Path $src -PathType Container) {
    robocopy $src $dst /E /NFL /NDL /NJH /NJS /nc /ns /np /XD node_modules .git src __tests__ | Out-Null
    # keep dist + package.json; for packages also need package.json from src root
    Copy-Item (Join-Path $src 'package.json') (Join-Path $dst 'package.json') -Force -ErrorAction SilentlyContinue
  } else {
    Copy-Item $src $dst -Force
  }
}
# Ensure package.json + dist for each package (robocopy may have skipped empty)
foreach ($pkg in @('shared','ollama-client','chat-backend','user-skills-loader','agent','gateway','cli')) {
  $srcPkg = Join-Path $Repo "packages\$pkg"
  $dstPkg = Join-Path $stage "packages\$pkg"
  New-Item -ItemType Directory -Force -Path $dstPkg | Out-Null
  Copy-Item (Join-Path $srcPkg 'package.json') $dstPkg -Force
  if (Test-Path (Join-Path $srcPkg 'dist')) {
    robocopy (Join-Path $srcPkg 'dist') (Join-Path $dstPkg 'dist') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
}

Copy-Item (Join-Path $Repo 'deploy\box-mini\.env.box') (Join-Path $stage '.env') -Force

$archive = Join-Path $env:TEMP 'caprigo-box.tgz'
if (Test-Path $archive) { Remove-Item $archive -Force }
Push-Location $stage
tar.exe -czf $archive *
Pop-Location
Write-Host "Archive size: $((Get-Item $archive).Length / 1MB) MB"

scp -i $Key -o BatchMode=yes $archive "${Remote}:C:/Users/box/caprigo-box.tgz"
ssh -i $Key -o BatchMode=yes $Remote cmd /c "if exist C:\Users\box\caprigo rmdir /s /q C:\Users\box\caprigo & mkdir C:\Users\box\caprigo & mkdir C:\Users\box\caprigo-workspace & tar -xzf C:\Users\box\caprigo-box.tgz -C C:\Users\box\caprigo & del C:\Users\box\caprigo-box.tgz"
Write-Host 'Remote npm install...'
ssh -i $Key -o BatchMode=yes $Remote cmd /c "cd /d C:\Users\box\caprigo && npm.cmd install --omit=dev"
scp -i $Key -o BatchMode=yes (Join-Path $Repo 'deploy\box-mini\RUN-CAPRIGO.cmd') "${Remote}:C:/Users/box/Desktop/RUN-CAPRIGO.cmd"
scp -i $Key -o BatchMode=yes (Join-Path $Repo 'deploy\box-mini\RUN-CAPRIGO.cmd') "${Remote}:C:/Users/box/RUN-CAPRIGO.cmd"
Write-Host 'DONE — Desktop RUN-CAPRIGO.cmd + C:\Users\box\RUN-CAPRIGO.cmd'
