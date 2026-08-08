@echo off
REM Double-click this when the mouse cursor is stuck in a region of the screen.
REM Releases the Windows cursor clip that Chromium can leave behind after
REM pointer lock on a scaled display. Pass "watch" to leave a guard running.
setlocal
if /I "%~1"=="watch" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cursor-guard.ps1" -Watch
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cursor-guard.ps1"
  echo.
  echo Done. Run "unstick-cursor.cmd watch" to keep a guard running while you play.
  pause
)
