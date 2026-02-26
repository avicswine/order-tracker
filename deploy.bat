@echo off
echo.
echo === Atualizando order-tracker ===
echo.

cd /d "%~dp0"

echo [1/4] Baixando atualizacoes do GitHub...
git pull origin main
if %errorlevel% neq 0 (
  echo ERRO: Falha ao executar git pull
  pause
  exit /b 1
)

echo.
echo [2/4] Instalando dependencias do backend...
cd backend
call npm install --omit=dev
cd ..

echo.
echo [3/4] Buildando o frontend...
cd frontend
call npm install --omit=dev
call npm run build
cd ..

echo.
echo [4/4] Reiniciando o servidor...
call pm2 restart order-tracker
if %errorlevel% neq 0 (
  echo Servidor nao estava rodando. Iniciando pela primeira vez...
  call pm2 start ecosystem.config.cjs --env production
)

echo.
echo === Deploy concluido! ===
echo Acesse: http://localhost:3001
echo.
pause
