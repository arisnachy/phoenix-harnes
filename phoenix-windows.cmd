@echo off
setlocal

cd /d "%~dp0"

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

rem PHOENIX stable-channel updater. Startup only announces an available update;
rem the detached watcher performs visible preflight, automatic restart, install,
rem rollback, and relaunch after the graphical client is available.
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

rem Best-effort local, keyless web search. Docker is optional for the harness;
rem when unavailable only web_search fails closed while PHOENIX keeps running.
if exist "scripts\phoenix-searxng.mjs" (
  node scripts\phoenix-searxng.mjs --ensure
)

call %PHOENIX_PNPM% run phoenix -- %*
exit /b %errorlevel%
