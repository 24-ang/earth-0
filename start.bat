@echo off
cd /d "%~dp0"
if exist state\session.json del /f /q state\*.json 2>nul
if exist state\turn_backups rmdir /s /q state\turn_backups 2>nul
powershell -ExecutionPolicy Bypass -File "start.ps1" %*
