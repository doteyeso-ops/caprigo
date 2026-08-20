@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "REBUILD="
if /I "%~1"=="--rebuild" set "REBUILD=1"
if /I "%~1"=="/rebuild" set "REBUILD=1"
if /I "%~1"=="rebuild" set "REBUILD=1"

if not exist "packages\cli\dist\index.js" set "REBUILD=1"
if not exist "packages\agent\dist\index.js" set "REBUILD=1"
if not exist "packages\agent\dist\skills\desktop-win.ps1" set "REBUILD=1"

if defined REBUILD (
  echo [Caprigo] Building agent (desktop/OCR skills)...
  call npm run build -w @caprigo/agent
  if errorlevel 1 (
    echo [Caprigo] Agent build failed.
    pause
    exit /b 1
  )
  echo [Caprigo] Building CLI...
  call npm run build -w @caprigo/cli
  if errorlevel 1 (
    echo [Caprigo] CLI build failed.
    pause
    exit /b 1
  )
)

echo [Caprigo] Launching HUD...
node "packages\cli\dist\index.js" tui
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo [Caprigo] Exited with code %EC%
  pause
)
exit /b %EC%
