@echo off
REM PLAYER ONE - Amizone auto-sync (called by Task Scheduler)
cd /d "%~dp0"
node amizone-auto.mjs >> amizone.log 2>&1
