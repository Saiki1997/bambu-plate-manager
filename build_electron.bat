@echo off
REM Build the Electron version (recommended)
cd /d "%~dp0electron"
if not exist node_modules (
  echo Installing Electron dependencies...
  call npm install
)
echo Building Windows package...
call npm run build
echo.
echo Done. Check electron\dist\
