@echo off
cd /d "%~dp0"

echo Iniciando Backend...
start "Backend" cmd /k "cd backend && npm run dev"

timeout /t 5 /nobreak >nul

echo Iniciando Frontend...
start "Frontend" cmd /k "cd frontend && npm run dev"

echo Iniciando Portal do Cliente...
start "Portal Cliente" cmd /k "cd customer-portal && npm run dev"

echo Aguardando servidores (15s)...
timeout /t 15 /nobreak >nul

start "" "http://localhost:5173"
start "" "http://localhost:5174"
