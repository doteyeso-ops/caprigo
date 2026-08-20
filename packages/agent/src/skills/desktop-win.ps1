# Caprigo desktop body — Win32 input + GDI+ screenshot helpers.
# Invoked as: powershell -NoProfile -File desktop-win.ps1 -Action <name> [-JsonArgs '{...}']

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$JsonArgs = '{}'
)

$ErrorActionPreference = 'Stop'
$argsObj = @{}
try {
  if ($JsonArgs -and $JsonArgs.Trim()) {
    $argsObj = $JsonArgs | ConvertFrom-Json
  }
} catch {
  Write-Output (@{ success = $false; error = "Invalid JsonArgs: $($_.Exception.Message)" } | ConvertTo-Json -Compress)
  exit 1
}

function Get-Prop($o, [string]$name, $default = $null) {
  if ($null -eq $o) { return $default }
  $p = $o.PSObject.Properties[$name]
  if ($null -eq $p) { return $default }
  return $p.Value
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CaprigoDesktop {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const int SM_CXSCREEN = 0;
  public const int SM_CYSCREEN = 1;
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Emit($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress -Depth 6)
}

function Get-ScreenSize {
  return @{
    width  = [CaprigoDesktop]::GetSystemMetrics(0)
    height = [CaprigoDesktop]::GetSystemMetrics(1)
  }
}

function Do-Screenshot {
  $path = [string](Get-Prop $argsObj 'path' '')
  if (-not $path) {
    $dir = Join-Path $env:TEMP 'caprigo-desktop'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $path = Join-Path $dir ("shot-{0}.png" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  }
  $dirName = Split-Path -Parent $path
  if ($dirName) { New-Item -ItemType Directory -Force -Path $dirName | Out-Null }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $x = [int](Get-Prop $argsObj 'x' 0)
  $y = [int](Get-Prop $argsObj 'y' 0)
  $w = Get-Prop $argsObj 'width' $null
  $h = Get-Prop $argsObj 'height' $null
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  if ($null -eq $w -or [int]$w -le 0) { $w = $bounds.Width - $x }
  if ($null -eq $h -or [int]$h -le 0) { $h = $bounds.Height - $y }
  $w = [Math]::Max(1, [int]$w)
  $h = [Math]::Max(1, [int]$h)

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  $pt = New-Object CaprigoDesktop+POINT
  [void][CaprigoDesktop]::GetCursorPos([ref]$pt)
  $sz = Get-ScreenSize
  Emit @{
    success = $true
    path    = $path
    width   = $w
    height  = $h
    origin_x = $x
    origin_y = $y
    screen_width = $sz.width
    screen_height = $sz.height
    cursor  = @{ x = $pt.X; y = $pt.Y }
  }
}

function Do-Move {
  $x = [int](Get-Prop $argsObj 'x' 0)
  $y = [int](Get-Prop $argsObj 'y' 0)
  [void][CaprigoDesktop]::SetCursorPos($x, $y)
  Emit @{ success = $true; x = $x; y = $y }
}

function Do-Click {
  $x = Get-Prop $argsObj 'x' $null
  $y = Get-Prop $argsObj 'y' $null
  if ($null -ne $x -and $null -ne $y) {
    [void][CaprigoDesktop]::SetCursorPos([int]$x, [int]$y)
    Start-Sleep -Milliseconds 30
  }
  $button = ([string](Get-Prop $argsObj 'button' 'left')).ToLowerInvariant()
  $double = [bool](Get-Prop $argsObj 'double' $false)
  $down = 0; $up = 0
  switch ($button) {
    'right' { $down = [CaprigoDesktop]::MOUSEEVENTF_RIGHTDOWN; $up = [CaprigoDesktop]::MOUSEEVENTF_RIGHTUP }
    'middle' { $down = [CaprigoDesktop]::MOUSEEVENTF_MIDDLEDOWN; $up = [CaprigoDesktop]::MOUSEEVENTF_MIDDLEUP }
    default { $down = [CaprigoDesktop]::MOUSEEVENTF_LEFTDOWN; $up = [CaprigoDesktop]::MOUSEEVENTF_LEFTUP }
  }
  $times = if ($double) { 2 } else { 1 }
  for ($i = 0; $i -lt $times; $i++) {
    [CaprigoDesktop]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [CaprigoDesktop]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    if ($i -lt $times - 1) { Start-Sleep -Milliseconds 80 }
  }
  $pt = New-Object CaprigoDesktop+POINT
  [void][CaprigoDesktop]::GetCursorPos([ref]$pt)
  Emit @{ success = $true; button = $button; double = $double; cursor = @{ x = $pt.X; y = $pt.Y } }
}

function Send-Vk([byte]$vk, [bool]$down) {
  $flags = if ($down) { [uint32]0 } else { [CaprigoDesktop]::KEYEVENTF_KEYUP }
  [CaprigoDesktop]::keybd_event($vk, 0, $flags, [UIntPtr]::Zero)
}

function Resolve-Vk([string]$name) {
  $n = $name.Trim().ToLowerInvariant()
  $map = @{
    'ctrl' = 0x11; 'control' = 0x11; 'alt' = 0x12; 'shift' = 0x10
    'win' = 0x5B; 'windows' = 0x5B; 'cmd' = 0x5B; 'meta' = 0x5B
    'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'escape' = 0x1B; 'esc' = 0x1B
    'space' = 0x20; 'backspace' = 0x08; 'delete' = 0x2E; 'del' = 0x2E
    'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
    'left' = 0x25; 'up' = 0x26; 'right' = 0x27; 'down' = 0x28
    'insert' = 0x2D; 'capslock' = 0x14
    'f1' = 0x70; 'f2' = 0x71; 'f3' = 0x72; 'f4' = 0x73
    'f5' = 0x74; 'f6' = 0x75; 'f7' = 0x76; 'f8' = 0x77
    'f9' = 0x78; 'f10' = 0x79; 'f11' = 0x7A; 'f12' = 0x7B
  }
  if ($map.ContainsKey($n)) { return [byte]$map[$n] }
  if ($n.Length -eq 1) {
    $ch = $n[0]
    if ($ch -ge 'a' -and $ch -le 'z') { return [byte]([int][char]$ch.ToString().ToUpperInvariant()[0]) }
    if ($ch -ge '0' -and $ch -le '9') { return [byte][int][char]$ch }
  }
  return $null
}

function Do-Hotkey {
  $keys = [string](Get-Prop $argsObj 'keys' '')
  if (-not $keys) { Emit @{ success = $false; error = 'keys required' }; return }
  $parts = @($keys -split '[+\-]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $vks = @()
  foreach ($p in $parts) {
    $vk = Resolve-Vk $p
    if ($null -eq $vk) { Emit @{ success = $false; error = "Unknown key: $p" }; return }
    $vks += $vk
  }
  foreach ($vk in $vks) { Send-Vk $vk $true; Start-Sleep -Milliseconds 15 }
  for ($i = $vks.Count - 1; $i -ge 0; $i--) { Send-Vk $vks[$i] $false; Start-Sleep -Milliseconds 15 }
  Emit @{ success = $true; keys = $keys }
}

function Do-Key {
  $key = [string](Get-Prop $argsObj 'key' '')
  if (-not $key) { Emit @{ success = $false; error = 'key required' }; return }
  $vk = Resolve-Vk $key
  if ($null -eq $vk) { Emit @{ success = $false; error = "Unknown key: $key" }; return }
  Send-Vk $vk $true
  Start-Sleep -Milliseconds 20
  Send-Vk $vk $false
  Emit @{ success = $true; key = $key }
}

function Do-Type {
  $text = [string](Get-Prop $argsObj 'text' '')
  $usePaste = [bool](Get-Prop $argsObj 'paste' $false)
  # Non-ASCII or explicit paste → clipboard + Ctrl+V
  if ($usePaste -or ($text -match '[^\x20-\x7E\r\n\t]')) {
    Set-Clipboard -Value $text
    Start-Sleep -Milliseconds 40
    Send-Vk 0x11 $true  # Ctrl
    Send-Vk 0x56 $true  # V
    Start-Sleep -Milliseconds 20
    Send-Vk 0x56 $false
    Send-Vk 0x11 $false
    Emit @{ success = $true; method = 'paste'; length = $text.Length }
    return
  }
  foreach ($ch in $text.ToCharArray()) {
    if ($ch -eq "`n" -or $ch -eq "`r") {
      Send-Vk 0x0D $true; Start-Sleep -Milliseconds 10; Send-Vk 0x0D $false
      continue
    }
    if ($ch -eq "`t") {
      Send-Vk 0x09 $true; Start-Sleep -Milliseconds 10; Send-Vk 0x09 $false
      continue
    }
    $scan = [CaprigoDesktop]::VkKeyScan($ch)
    if ($scan -eq -1) { continue }
    $vk = [byte]($scan -band 0xFF)
    $shift = (($scan -shr 8) -band 1) -eq 1
    if ($shift) { Send-Vk 0x10 $true }
    Send-Vk $vk $true
    Start-Sleep -Milliseconds 8
    Send-Vk $vk $false
    if ($shift) { Send-Vk 0x10 $false }
    Start-Sleep -Milliseconds 5
  }
  Emit @{ success = $true; method = 'keys'; length = $text.Length }
}

function Do-Windows {
  $list = New-Object System.Collections.Generic.List[object]
  $callback = [CaprigoDesktop+EnumWindowsProc]{
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    if (-not [CaprigoDesktop]::IsWindowVisible($hwnd)) { return $true }
    $len = [CaprigoDesktop]::GetWindowTextLength($hwnd)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [void][CaprigoDesktop]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $procId = [uint32]0
    [void][CaprigoDesktop]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $list.Add(@{ title = $title; pid = $procId; hwnd = $hwnd.ToInt64() }) | Out-Null
    return $true
  }
  [void][CaprigoDesktop]::EnumWindows($callback, [IntPtr]::Zero)
  $fg = [CaprigoDesktop]::GetForegroundWindow().ToInt64()
  Emit @{ success = $true; count = $list.Count; foreground_hwnd = $fg; windows = $list }
}

function Do-Focus {
  $title = [string](Get-Prop $argsObj 'title' '')
  if (-not $title) { Emit @{ success = $false; error = 'title required' }; return }
  $clickInto = $true
  $clickProp = Get-Prop $argsObj 'click' $null
  if ($null -ne $clickProp) { $clickInto = [bool]$clickProp }

  $script:focusNeedle = $title.ToLowerInvariant()
  $script:focusCandidates = New-Object System.Collections.Generic.List[object]
  $callback = [CaprigoDesktop+EnumWindowsProc]{
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    if (-not [CaprigoDesktop]::IsWindowVisible($hwnd)) { return $true }
    $len = [CaprigoDesktop]::GetWindowTextLength($hwnd)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [void][CaprigoDesktop]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $t = $sb.ToString()
    $tl = $t.ToLowerInvariant()
    if (-not $tl.Contains($script:focusNeedle)) { return $true }
    # Prefer real app titles; deprioritize IDE/chat chrome that merely mentions the app.
    $score = 10
    if ($tl -eq $script:focusNeedle) { $score = 100 }
    elseif ($tl.EndsWith($script:focusNeedle)) { $score = 80 }
    elseif ($tl -match ('^untitled\s*[-–—]\s*' + [regex]::Escape($script:focusNeedle))) { $score = 90 }
    if ($tl -match 'cursor|visual studio code|caprigo hud') { $score -= 50 }
    $script:focusCandidates.Add(@{ hwnd = $hwnd; title = $t; score = $score }) | Out-Null
    return $true
  }
  [void][CaprigoDesktop]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:focusCandidates.Count -eq 0) {
    Emit @{ success = $false; error = "No window matching title: $title" }
    return
  }
  $best = $script:focusCandidates | Sort-Object { -$_.score } | Select-Object -First 1
  $hwnd = [IntPtr]$best.hwnd

  $fg = [CaprigoDesktop]::GetForegroundWindow()
  $fgPid = [uint32]0
  $targetPid = [uint32]0
  $fgTid = [CaprigoDesktop]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $targetTid = [CaprigoDesktop]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
  $curTid = [CaprigoDesktop]::GetCurrentThreadId()

  try { [void][CaprigoDesktop]::AllowSetForegroundWindow(-1) } catch { }
  $attachedFg = $false
  $attachedTarget = $false
  if ($fgTid -ne 0 -and $fgTid -ne $curTid) {
    $attachedFg = [CaprigoDesktop]::AttachThreadInput($curTid, $fgTid, $true)
  }
  if ($targetTid -ne 0 -and $targetTid -ne $curTid -and $targetTid -ne $fgTid) {
    $attachedTarget = [CaprigoDesktop]::AttachThreadInput($curTid, $targetTid, $true)
  }

  [void][CaprigoDesktop]::ShowWindow($hwnd, [CaprigoDesktop]::SW_RESTORE)
  [void][CaprigoDesktop]::ShowWindow($hwnd, [CaprigoDesktop]::SW_SHOW)
  [void][CaprigoDesktop]::BringWindowToTop($hwnd)
  $setOk = [CaprigoDesktop]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 120

  if ($attachedTarget) { [void][CaprigoDesktop]::AttachThreadInput($curTid, $targetTid, $false) }
  if ($attachedFg) { [void][CaprigoDesktop]::AttachThreadInput($curTid, $fgTid, $false) }

  $rect = New-Object CaprigoDesktop+RECT
  [void][CaprigoDesktop]::GetWindowRect($hwnd, [ref]$rect)
  $clicked = $false
  if ($clickInto) {
    $cx = [int](($rect.Left + $rect.Right) / 2)
    $cy = [int](($rect.Top + $rect.Bottom) / 2)
    # Prefer client area below title bar
    if (($rect.Bottom - $rect.Top) -gt 80) {
      $cy = [int]($rect.Top + 48 + (($rect.Bottom - $rect.Top - 48) / 2))
    }
    [void][CaprigoDesktop]::SetCursorPos($cx, $cy)
    Start-Sleep -Milliseconds 30
    [CaprigoDesktop]::mouse_event([CaprigoDesktop]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    [CaprigoDesktop]::mouse_event([CaprigoDesktop]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    $clicked = $true
    Start-Sleep -Milliseconds 80
  }

  $nowFg = [CaprigoDesktop]::GetForegroundWindow()
  $verified = ($nowFg -eq $hwnd)
  # Soft success if SetForeground claimed ok or we clicked into the window — Windows often
  # reports a different FG briefly under elevated IDEs, but clicks still land.
  $ok = $verified -or $setOk -or $clicked
  if (-not $ok) {
    Emit @{
      success = $false
      error = "Focus not verified for: $($best.title)"
      title = $best.title
      hwnd = $hwnd.ToInt64()
      foreground_hwnd = $nowFg.ToInt64()
    }
    return
  }
  Emit @{
    success = $true
    title = $best.title
    hwnd = $hwnd.ToInt64()
    verified = $verified
    clicked = $clicked
    score = $best.score
    candidates = $script:focusCandidates.Count
  }
}

function Do-Cursor {
  $pt = New-Object CaprigoDesktop+POINT
  [void][CaprigoDesktop]::GetCursorPos([ref]$pt)
  $sz = Get-ScreenSize
  Emit @{ success = $true; cursor = @{ x = $pt.X; y = $pt.Y }; screen_width = $sz.width; screen_height = $sz.height }
}

try {
  switch ($Action.ToLowerInvariant()) {
    'screenshot' { Do-Screenshot }
    'move' { Do-Move }
    'click' { Do-Click }
    'type' { Do-Type }
    'hotkey' { Do-Hotkey }
    'key' { Do-Key }
    'windows' { Do-Windows }
    'focus' { Do-Focus }
    'cursor' { Do-Cursor }
    default { Emit @{ success = $false; error = "Unknown action: $Action" } }
  }
} catch {
  Emit @{ success = $false; error = $_.Exception.Message }
  exit 1
}
