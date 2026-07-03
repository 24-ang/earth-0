@echo off
del /f /q "%~dp0state\*.json" 2>nul
rmdir /s /q "%~dp0state\turn_backups" 2>nul
start "" "C:\Program Files\Git\git-bash.exe" --cd="%~dp0" -c "./start.sh"
