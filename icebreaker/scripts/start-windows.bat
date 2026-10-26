@echo off
rem Icebreaker-Games: starts the server of the full bundle (docs/deploy.md). Needs Node.js 22.12 or newer.
rem The arguments go to the server, e.g. start-windows.bat --port 8800
rem (ASCII only: cmd misreads multibyte text in batch files; scripts\launch.js prints the Chinese messages.)
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or 24 first: https://nodejs.org/
  pause
  exit /b 1
)
node scripts\launch.js %*
if errorlevel 1 pause
