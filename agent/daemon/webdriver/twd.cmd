@echo off
rem tmwebdriver CLI launcher (Windows .cmd)
rem Prefers `py -3` (Python Launcher), falls back to `python`.
setlocal
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "LANG=C.UTF-8"
set "LC_ALL=C.UTF-8"
chcp 65001 >NUL 2>NUL

set "HERE=%~dp0"
set "TWD=%HERE%twd.py"

:: Forward TWD_TOKEN if set
if defined TWD_TOKEN (
  set "TWD_TOKEN=%TWD_TOKEN%"
)

:: Forward TWD_PORT if set (default 18765, Slock Bridge uses 28765)
if defined TWD_PORT (
  set "TWD_PORT=%TWD_PORT%"
)

where py >NUL 2>NUL
if not errorlevel 1 (
  py -3 "%TWD%" %*
  exit /b %ERRORLEVEL%
)

where python >NUL 2>NUL
if not errorlevel 1 (
  python "%TWD%" %*
  exit /b %ERRORLEVEL%
)

echo twd: no python found in PATH 1>&2
exit /b 127
