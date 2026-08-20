# Caprigo desktop OCR — Windows.Media.Ocr fallback (no Python).
# Usage: powershell -File desktop-ocr-win.ps1 -Path <png> [-MaxBlocks 120]

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$MaxBlocks = 120
)

$ErrorActionPreference = 'Stop'

function Emit($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress -Depth 8)
}

if (-not (Test-Path -LiteralPath $Path)) {
  Emit @{ success = $false; error = "file not found: $Path" }
  exit 1
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.IsGenericMethod -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await-WinRt($asyncOp, [Type]$resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($asyncOp))
  $task.GetAwaiter().GetResult()
}

try {
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
} catch {
  Emit @{ success = $false; error = "WinRT OCR types unavailable: $($_.Exception.Message)" }
  exit 1
}

try {
  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Path).Path)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) {
    Emit @{ success = $false; error = 'OcrEngine.TryCreateFromUserProfileLanguages returned null' }
    exit 1
  }
  $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $blocks = New-Object System.Collections.Generic.List[object]
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($line in $result.Lines) {
    $text = [string]$line.Text
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    $r = $line.Words | ForEach-Object { $_.BoundingRect }
    if (-not $r) { continue }
    $x0 = ($r | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
    $y0 = ($r | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
    $x1 = ($r | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
    $y1 = ($r | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
    $w = [Math]::Max(1, [int]($x1 - $x0))
    $h = [Math]::Max(1, [int]($y1 - $y0))
    $cx = [int]([Math]::Round($x0 + $w / 2.0))
    $cy = [int]([Math]::Round($y0 + $h / 2.0))
    $blocks.Add(@{
      text = $text.Trim()
      x = [int]$x0
      y = [int]$y0
      w = $w
      h = $h
      cx = $cx
      cy = $cy
      conf = 0.0
    }) | Out-Null
    $lines.Add($text.Trim()) | Out-Null
    if ($blocks.Count -ge $MaxBlocks) { break }
  }

  Emit @{
    success = $true
    engine  = 'winrt'
    path    = (Resolve-Path -LiteralPath $Path).Path
    count   = $blocks.Count
    blocks  = $blocks
    text    = ($lines -join "`n")
  }
} catch {
  Emit @{ success = $false; error = $_.Exception.Message }
  exit 1
}
