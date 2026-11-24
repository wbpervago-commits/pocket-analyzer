@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Установка загрузчика истории Pocket Option...
py -3 -m pip install --upgrade "git+https://github.com/chema-creator/PocketOptionApi.git"
if errorlevel 1 (
  echo.
  echo Не удалось установить зависимости. Проверьте, установлен ли Python 3.
  pause
  exit /b 1
)
echo.
echo Запуск проверки истории...
py -3 download_history.py
pause
