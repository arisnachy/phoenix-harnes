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

rem Normal stable updates are owned by the detached watcher below so PHOENIX
rem can stay open, report real preparation phases in the Web UI, and ask for an
rem explicit restart only after the candidate passed preflight. The managed
rem updater remains an opt-in recovery path for a legacy checkout that must be
rem realigned to the promoted stable commit.
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

rem Keep updater staging paths deliberately short on Windows. Deep workspace
rem dependency trees can otherwise exceed legacy Win32 path limits during Git
rem worktree cleanup even after a candidate has already passed preflight.
set "PHOENIX_UPDATE_TEMP=%USERPROFILE%\p"
if not exist "%PHOENIX_UPDATE_TEMP%" mkdir "%PHOENIX_UPDATE_TEMP%" >nul 2>nul

rem Start the stable watcher outside the Host process. The Windows shim routes
rem .cmd package-manager shims through cmd.exe before loading the updater. Only
rem the watcher receives the short TEMP/TMP roots; PHOENIX itself keeps the
rem user's normal temp configuration.
if not "%PHOENIX_AUTO_UPDATE%"=="0" if exist "scripts\phoenix-auto-update.mjs" if exist "scripts\phoenix-windows-command-shim.mjs" (
  for /f "usebackq delims=" %%P in (`node -p "process.ppid"`) do set "PHOENIX_LAUNCHER_PID=%%P"
  if defined PHOENIX_LAUNCHER_PID (
    node -e "const {spawn}=require('node:child_process');const env={...process.env,TEMP:process.env.PHOENIX_UPDATE_TEMP,TMP:process.env.PHOENIX_UPDATE_TEMP};const child=spawn(process.execPath,['scripts/phoenix-windows-command-shim.mjs','scripts/phoenix-auto-update.mjs','--watch','--parent-pid',process.argv[1]],{cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:true,env});child.unref()" "%PHOENIX_LAUNCHER_PID%" >nul 2>nul
  )
)

call %PHOENIX_PNPM% run phoenix -- %*
exit /b %errorlevel%
