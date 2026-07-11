@echo off
cd /d "%~dp0"
call npm run exe
if errorlevel 1 (
    echo.
    echo BUILD FAILED — see the error above.
    pause
    exit /b 1
)
echo.
echo Done! Portable build is at: release\Hub-win32-x64\Hub.exe
pause
