@echo off
setlocal enableextensions
cd /d "%~dp0.."
echo ================================================
echo   PromptPair 构建残留清理
echo ================================================
echo.
"%SystemRoot%\System32\tasklist.exe" /fi "imagename eq WorkBuddy.exe" 2>nul | "%SystemRoot%\System32\find.exe" /i "WorkBuddy.exe" >nul
if not errorlevel 1 goto BUSY
"%SystemRoot%\System32\tasklist.exe" /fi "imagename eq PromptPair.exe" 2>nul | "%SystemRoot%\System32\find.exe" /i "PromptPair.exe" >nul
if not errorlevel 1 echo [注意] PromptPair 正在运行，建议先关掉再清理。
set FAILED=0
for %%D in (release rel rel2 dist) do (
  if exist "%%D" (
    rd /s /q "%%D" 2>nul
    if exist "%%D" (
      echo   [失败] %%D 没能删干净
      set FAILED=1
    ) else (
      echo   [完成] 已删除 %%D
    )
  )
)
echo.
if "%FAILED%"=="1" goto LEFTOVER
echo 清理完成。以后构建产物只会出现在 release 目录。
echo.
pause
exit /b 0

:BUSY
echo [无法清理] WorkBuddy 正在运行，它占着这些文件。
echo.
echo   1. 完全退出 WorkBuddy（托盘图标也要退出）
echo   2. 再双击本文件
echo.
pause
exit /b 1

:LEFTOVER
echo 仍有目录未删净，通常是还有进程占用。
echo   1. 确认 WorkBuddy 与 PromptPair 都已退出
echo   2. 再双击本文件重试
echo.
pause
exit /b 1
