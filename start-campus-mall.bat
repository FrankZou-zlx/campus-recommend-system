@echo off
setlocal
title 校园电商推荐网站 - 一键启动

REM ========== 基本路径 ==========
set "ROOT=D:\workbuddy.file\2026-09-03-13-40-36\campus-mall"
set "MYSQLD=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"
set "MYSQL_DATA=D:\workbuddy.file\2026-09-03-13-40-36\.mysql\data"
set "MYSQL_BASE=C:\Program Files\MySQL\MySQL Server 8.0"

REM ========== 找 node ==========
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "NODE=C:\Users\zlx59\.workbuddy\binaries\node\versions\22.22.2\node.exe"
)
echo 使用 node: %NODE%

REM ========== 1. 启动本地 MySQL（端口 3306） ==========
echo [1/3] 启动本地 MySQL ...
set "MYSQL_RUNNING=0"
(netstat -an 2>nul | findstr ":3306" >nul) && set "MYSQL_RUNNING=1"
if "%MYSQL_RUNNING%"=="1" (
  echo     3306 端口已被占用，跳过 MySQL 启动（如需重启请先停止占用进程）
) else (
  start "MySQL" "%MYSQLD%" --basedir="%MYSQL_BASE%" --datadir="%MYSQL_DATA%" --port=3306 --console
)

REM ========== 2. 启动后端 API（端口 3001） ==========
echo [2/3] 启动后端 API (http://localhost:3001) ...
start "Backend" cmd /k "cd /d %ROOT%\backend && %NODE% src/app.js"

REM ========== 3. 启动前端（端口 8080） ==========
echo [3/3] 启动前端 (http://localhost:8080) ...
start "Frontend" cmd /k "cd /d %ROOT%\frontend && %NODE% serve.cjs"

REM ========== 打开浏览器 ==========
echo 稍等 5 秒后自动打开浏览器 ...
timeout /t 5 >nul
start http://localhost:8080

echo.
echo 启动完成！浏览器应已打开校园电商推荐网站。
echo 演示账号：普通用户 user001~user120 / 123456，后台 admin / admin123
echo 关闭演示：直接关掉弹出的三个命令行窗口即可。
pause
endlocal
