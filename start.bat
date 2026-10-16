@echo off
setlocal
cd /d %~dp0

REM ===== Dev launcher: run the current source directly with the local Electron binary =====
REM No packaging and no electron-builder, so it avoids the Windows file-lock issues that
REM block deleting electron-builder output dirs (dist-dev / dist-win / release ...).
REM Requires: node_modules installed (run "npm install" once).

REM --- locate managed node.exe (only used to resolve npm path / future tweaks) ---
set NODE=
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%~fd\node.exe" set "NODE=%%~fd\node.exe"
)

REM --- locate electron.exe from the local electron dependency ---
set ELECTRON=%~dp0node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" (
  echo [ERROR] electron.exe not found at:
  echo   %ELECTRON%
  echo Run "npm install" first to fetch the Electron runtime.
  pause
  exit /b 1
)

echo launching whalechan desktop pet (dev)...
start "" "%ELECTRON%" .
echo launched. closing this window in 3s...
timeout /t 3 >nul
