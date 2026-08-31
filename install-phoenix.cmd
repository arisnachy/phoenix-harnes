@echo off
setlocal

rem One-click Windows entry point. The installer owns its PowerShell invocation
rem so users do not need to open a terminal or know the script location.
set "PHOENIX_INSTALLER=%~dp0install-phoenix.ps1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PHOENIX_INSTALLER%" %*
exit /b %ERRORLEVEL%
