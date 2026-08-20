# Setup Caprigo desktop OCR RapidOCR venv (optional; WinRT works without this).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root 'packages\agent\.venv-ocr'
$py = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host "Creating $venv"
  python -m venv $venv
}
& $py -m pip install --upgrade pip
& $py -m pip install rapidocr-onnxruntime pillow
Write-Host "OK RapidOCR venv at $venv"
Write-Host "Set CAPRIGO_OCR_ENGINE=rapidocr to prefer it (default auto uses fast WinRT)."
