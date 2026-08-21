@echo off
setlocal enabledelayedexpansion
title Install watsmytask

REM Double-click this file to install watsmytask on Windows.
REM
REM It installs into %LOCALAPPDATA%\watsmytask, a folder your account owns, rather than
REM running "npm install -g". That keeps the whole thing free of UAC prompts and leaves
REM nothing behind outside your own user folder.
REM
REM Everything below is deliberately plain ASCII and uses batch's own GEQ/GTR comparisons
REM rather than passing an expression to node: ">" and "<" mean redirection to cmd.exe,
REM and a stray one turns a version check into a file it silently creates.

set "APP_NAME=watsmytask"
set "PACKAGE=watsmytask"
REM Which version to install. "latest" is what you get running this out of the repo;
REM build-release.sh rewrites it to the exact version when packing a release zip, so a
REM zip labelled 1.0.0 installs 1.0.0. Pinning also makes a release whose npm publish
REM never happened fail here loudly, rather than quietly installing the old version.
set "VERSION_SPEC=latest"
set "APP_DIR=%LOCALAPPDATA%\watsmytask"
set "LAUNCHER=%USERPROFILE%\Desktop\watsmytask.bat"
set "MIN_NODE_MAJOR=20"
set "MIN_NODE_MINOR=11"

echo.
echo   Installing %APP_NAME%
echo.

REM ------------------------------------------------------------- find Node
REM Node's installer adds itself to PATH, but a fresh install is not visible to an
REM already-open window, so check the usual folders too before declaring it missing.
call :check_node
if "%NODE_OK%"=="1" goto node_ready

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles(x86)%\nodejs"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Programs\nodejs"
call :check_node
if "%NODE_OK%"=="1" goto node_ready

where node >nul 2>&1
if errorlevel 1 (
  echo   [-] Node is not installed. watsmytask needs it to run.
) else (
  echo   [-] Your version of Node is too old. Version %MIN_NODE_MAJOR%.%MIN_NODE_MINOR% or newer is needed.
)

where winget >nul 2>&1
if errorlevel 1 goto node_manual

echo.
set "REPLY="
set /p "REPLY=  Install Node automatically with winget? [Y/n] "
if /i "!REPLY!"=="n" goto node_manual
echo.
echo   Installing Node. This takes a few minutes...
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
call :check_node
if "%NODE_OK%"=="1" goto node_ready
echo.
echo   [-] Node was installed, but this window still cannot see it.
echo       Close this window and double-click the installer again.
goto fail

:node_manual
echo.
echo   [x] Node %MIN_NODE_MAJOR%.%MIN_NODE_MINOR% or newer is required.
echo.
echo   Install it, then run this installer again:
echo.
echo     - Download the LTS installer:  https://nodejs.org
echo     - Or, in a terminal:           winget install OpenJS.NodeJS.LTS
echo.
set "REPLY="
set /p "REPLY=  Open nodejs.org now? [Y/n] "
if /i not "!REPLY!"=="n" start "" "https://nodejs.org/en/download"
goto fail

:node_ready
for /f "tokens=*" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo   [ok] Node !NODE_VERSION! is installed.

where npm >nul 2>&1
if errorlevel 1 (
  echo   [x] npm was not found next to Node. Reinstall Node from https://nodejs.org.
  goto fail
)

REM --------------------------------------------------------------- install
echo.
echo   Downloading %APP_NAME%...
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
if not exist "%APP_DIR%" (
  echo   [x] Could not create %APP_DIR%
  goto fail
)

REM A private package.json keeps npm from walking up and adopting a parent folder.
if not exist "%APP_DIR%\package.json" (
  > "%APP_DIR%\package.json" echo { "name": "watsmytask-install", "private": true }
)

call npm install --prefix "%APP_DIR%" --no-audit --no-fund %PACKAGE%@%VERSION_SPEC%
if errorlevel 1 (
  echo.
  echo   [x] Could not download %PACKAGE% %VERSION_SPEC%.
  echo       Check that you are online, then run this installer again.
  echo       If it says no matching version was found, this installer is newer
  echo       than what has been published. Get the current one from:
  echo         https://github.com/CharmFlex-Studio/Smart-Task-Planner/releases/latest
  echo       Behind a corporate proxy, npm needs to know about it:
  echo         npm config set proxy http://your-proxy:port
  goto fail
)

set "ENTRY=%APP_DIR%\node_modules\%PACKAGE%\bin\%PACKAGE%.mjs"
if not exist "%ENTRY%" (
  echo   [x] The install finished but this file is missing:
  echo       %ENTRY%
  goto fail
)
echo   [ok] %APP_NAME% installed.

REM -------------------------------------------------------------- launcher
> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo REM Starts watsmytask. Written by the installer; safe to delete.
>> "%LAUNCHER%" echo title watsmytask
>> "%LAUNCHER%" echo if exist "%%ProgramFiles%%\nodejs\node.exe" set "PATH=%%PATH%%;%%ProgramFiles%%\nodejs"
>> "%LAUNCHER%" echo node "%%LOCALAPPDATA%%\watsmytask\node_modules\watsmytask\bin\watsmytask.mjs" %%*
>> "%LAUNCHER%" echo if errorlevel 1 pause
echo   [ok] Added "%APP_NAME%" to your Desktop.

REM -------------------------------------------------------------------- run
echo.
echo   Done.
echo.
echo   To start it again later, double-click "watsmytask" on your Desktop.
echo.
echo   Your tasks are plain markdown files in:
echo     %USERPROFILE%\watsmytask-vault
echo   Back that folder up and you have backed up everything.
echo.
set "REPLY="
set /p "REPLY=  Start %APP_NAME% now? [Y/n] "
if /i "!REPLY!"=="n" goto done
echo.
node "%ENTRY%"
goto done

REM Sets NODE_OK to 1 when node is present and new enough. "node -v" prints v22.14.0,
REM so treating "v" and "." as delimiters gives the major and minor directly.
:check_node
set "NODE_OK=0"
set "NMAJ="
set "NMIN="
where node >nul 2>&1
if errorlevel 1 exit /b 0
for /f "tokens=1,2 delims=v." %%a in ('node -v 2^>nul') do (
  set "NMAJ=%%a"
  set "NMIN=%%b"
)
if not defined NMAJ exit /b 0
if !NMAJ! GTR %MIN_NODE_MAJOR% set "NODE_OK=1"
if !NMAJ! EQU %MIN_NODE_MAJOR% if !NMIN! GEQ %MIN_NODE_MINOR% set "NODE_OK=1"
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1

:done
echo.
pause
endlocal
exit /b 0
