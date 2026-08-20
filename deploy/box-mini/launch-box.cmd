@echo off
title Caprigo
cd /d "%~dp0..\.."
set PATH=C:\Program Files\nodejs;%PATH%
set CAPRIGO_BOX_PROFILE=1
set OLLAMA_VULKAN=1
set OLLAMA_IGPU_ENABLE=1

taskkill /F /IM llama-server.exe >nul 2>&1

curl -s -m 2 http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  start "" /MIN "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
  timeout /t 3 /nobreak >nul
)

curl -s -m 2 http://127.0.0.1:18789/health >nul 2>&1
if errorlevel 1 (
  echo Starting Caprigo...
  start "Caprigo" /MIN cmd /c "cd /d "%CD%" && set CAPRIGO_BOX_PROFILE=1&& node packages\gateway\dist\index.js"
  timeout /t 5 /nobreak >nul
)

node packages\cli\dist\index.js
