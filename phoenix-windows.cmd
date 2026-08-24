@echo off
setlocal

cd /d "%~dp0"

if exist ".phoenix-managed-install" if not "%PHOENIX_AUTO_UPDATE%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-phoenix.ps1" || exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo PHOENIX requires Node.js 22.19 or newer. Install Node.js, then run this file again.
  exit /b 1
)

where corepack >nul 2>nul
if errorlevel 1 (
  echo Corepack is not bundled with this Node.js release; using pinned Corepack 0.34.6.
  set "PHOENIX_PNPM=npm exec --yes corepack@0.34.6 pnpm --"
) else (
  set "PHOENIX_PNPM=corepack pnpm"
)

rem PHOENIX stable-channel updater. Network/check failures never prevent the
rem last-known-good build from starting; exit code 12 means live install AND
rem rollback failed, so continuing would no longer be safe.
if exist "scripts\phoenix-auto-update.mjs" (
  node scripts\phoenix-auto-update.mjs --startup
  if errorlevel 12 (
    echo PHOENIX update recovery failed. Review .git\phoenix-update-state.json before continuing.
    exit /b 12
  )
)

if not exist "node_modules\.pnpm" (
  echo Preparing PHOENIX dependencies...
  call %PHOENIX_PNPM% install --frozen-lockfile || exit /b 1
)

if not exist "apps\cli\lib\bin.js" (
  echo Building PHOENIX for the first run...
  call %PHOENIX_PNPM% run build || exit /b 1
)

call %PHOENIX_PNPM% run phoenix -- %*
exit /b %errorlevel%
