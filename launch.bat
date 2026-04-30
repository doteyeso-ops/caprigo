@echo off
setlocal
set SCRIPT_DIR=%~dp0

set PS_NOEXIT=
if "%~1"=="" set PS_NOEXIT=-NoExit

powershell %PS_NOEXIT% -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launch.ps1" %*
exit /b %ERRORLEVEL%
