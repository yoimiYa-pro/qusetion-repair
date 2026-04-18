@echo off
chcp 65001 >nul
title 错题整理 - 本地开发
cd /d "%~dp0"

where npm >nul 2>nul || (
  echo [错误] 未找到 npm，请先安装 Node.js 并重新打开终端。
  pause
  exit /b 1
)

echo.
echo 正在启动：后端 + 前端（与在项目根执行 npm run dev 相同）
echo 浏览器打开: http://localhost:5173
echo 按 Ctrl+C 可停止两个服务。
echo.

npm run dev
if errorlevel 1 pause
