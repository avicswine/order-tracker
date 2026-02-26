@echo off
echo.
echo === Atualizando order-tracker ===
echo.

cd /d "%~dp0"

:: Garante que npm global e git estejam no PATH
set "NPM_GLOBAL=C:\Users\User\AppData\Roaming\npm"
set "GIT_PATH=C:\Users\Jeovan\AppData\Local\Programs\Git\cmd"
set "PATH=%PATH%;%NPM_GLOBAL%;%GIT_PATH%"

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
call npm install
call npm run build
cd ..

echo.
echo [4/4] Reiniciando o servidor...
call "%NPM_GLOBAL%\pm2" restart order-tracker
if %errorlevel% neq 0 (
  echo Servidor nao estava rodando. Iniciando pela primeira vez...
  call "%NPM_GLOBAL%\pm2" start ecosystem.config.cjs --env production
)

echo.
echo === Deploy concluido! ===
echo Acesse: http://localhost:3001
echo.
pause
