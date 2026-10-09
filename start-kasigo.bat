@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required to run KasiGo.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)

start "KasiGo" cmd /k "cd /d ""%~dp0"" ^&^& npm start"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
endlocal
