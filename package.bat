@echo off
setlocal
cd /d %~dp0

REM ===== One-click packaging (Windows) =====
REM Auto-detects the OS via package.js and builds the matching installer.
REM On this machine it uses the local Electron runtime (node_modules/electron/dist)
REM and skips any download, so no .electron-dist is needed.

REM --- locate node.exe (system first, then the WorkBuddy-managed runtime) ---
set NODE=
where node >nul 2>nul
if %errorlevel%==0 set "NODE=node"
if not defined NODE (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%~fd\node.exe" set "NODE=%%~fd\node.exe"
  )
)
if not defined NODE (
  echo [ERROR] node.exe not found. Install Node.js, then retry.
  pause
  exit /b 1
)

echo [info] node: %NODE%
echo.

"%NODE%" "%~dp0package.js"

echo.
echo Press any key to close...
pause >nul
