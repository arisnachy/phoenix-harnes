@echo off
setlocal

cd /d "%~dp0"

rem Preserve the normal user temp roots for PHOENIX itself. A relaunched Host may
rem inherit the updater's intentionally short TEMP/TMP values, so restore the
rem original runtime values before starting normal application processes.
if defined PHOENIX_RUNTIME_TEMP set "TEMP=%PHOENIX_RUNTIME_TEMP%"
if defined PHOENIX_RUNTIME_TMP set "TMP=%PHOENIX_RUNTIME_TMP%"
if not defined PHOENIX_RUNTIME_TEMP set "PHOENIX_RUNTIME_TEMP=%TEMP%"
if not defined PHOENIX_RUNTIME_TMP set "PHOENIX_RUNTIME_TMP=%TMP%"

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

rem Normal stable updates are owned by the detached watcher started by the
rem Windows supervisor below. The managed updater remains an opt-in recovery
rem path for a legacy checkout that must be realigned to promoted stable.
if exist ".phoenix-managed-install" if "%PHOENIX_STABLE_REPAIR%"=="1" (
  if not "%PHOENIX_AUTO_UPDATE%"=="0" if exist "scripts\phoenix-managed-update.mjs" (
    if exist "scripts\phoenix-windows-command-shim.mjs" (
      node scripts\phoenix-windows-command-shim.mjs scripts\phoenix-managed-update.mjs --startup
    ) else (
      node scripts\phoenix-managed-update.mjs --startup
    )
    if errorlevel 12 (
      echo PHOENIX stable recovery failed. Review .git\phoenix-update-state.json before continuing.
      exit /b 12
    )
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

rem HARDNESS self-protection is a launcher fact, not a model instruction. The
rem live checkout and PHOENIX data home become non-writable to model-controlled
rem file/shell capabilities. A detached sibling worktree is the writable place
rem for self-evolution. Failure to create it leaves self-modification read-only.
if not "%PHOENIX_HARDNESS_SELF_PROTECT%"=="0" (
  set "PHOENIX_RUNTIME_ROOT=%CD%"
  if exist "scripts\phoenix-evolution-worktree.mjs" (
    for /f "usebackq delims=" %%P in (`node scripts\phoenix-evolution-worktree.mjs`) do set "PHOENIX_EVOLUTION_ROOT=%%P"
  )
)

rem Keep updater staging paths deliberately short on Windows. Only the updater
rem watcher receives these roots; PHOENIX itself retains the user's normal TEMP.
set "PHOENIX_UPDATE_TEMP=%USERPROFILE%\p"
if not exist "%PHOENIX_UPDATE_TEMP%" mkdir "%PHOENIX_UPDATE_TEMP%" >nul 2>nul

rem The supervisor owns the exact Host PID and binds the updater watcher to that
rem process. This avoids PowerShell/cmd.exe PID ambiguity during Restart.
if exist "scripts\phoenix-windows-supervisor.mjs" (
  node scripts\phoenix-windows-supervisor.mjs %*
  exit /b %errorlevel%
)

rem Legacy fallback for checkouts that do not yet contain the supervisor.
call %PHOENIX_PNPM% run phoenix -- %*
exit /b %errorlevel%
