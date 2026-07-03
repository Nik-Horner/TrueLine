@echo off
rem TrueLine desktop launcher
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing Electron runtime...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .
