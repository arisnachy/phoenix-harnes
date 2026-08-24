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

rem Managed installations follow ONLY the promoted stable channel. This path
rem can safely realign a legacy install that was accidentally advanced to
rem origin/main. Development checkouts keep the non-downgrading updater below.
if exist ".phoenix-managed-install" (
  if not "%PHOENIX_AUTO_UPDATE%"=="0" if exist "scripts\phoenix-managed-update.mjs" (
    node scripts\phoenix-managed-update.mjs --startup
    if errorlevel 12 (
      echo PHOENIX stable recovery failed. Review .git\phoenix-update-state.json before continuing.
      exit /b 12
    )
  )
) else (
  rem Source/development checkouts may move forward to a promoted stable commit,
  rem but the standard updater never downgrades a checkout that is ahead.
  if exist "scripts\phoenix-auto-update.mjs" (
    node scripts\phoenix-auto-update.mjs --startup
    if errorlevel 12 (
      echo PHOENIX update recovery failed. Review .git\phoenix-update-state.json before continuing.
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

call %PHOENIX_PNPM% run phoenix -- %*
exit /b %errorlevel%
