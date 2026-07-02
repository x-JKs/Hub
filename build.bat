@echo off
cd /d "%~dp0"
call npm run exe
echo.
echo Done! Portable build is at: release\Hub-win32-x64\Hub.exe
pause
