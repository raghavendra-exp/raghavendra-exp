@echo off
echo ====================================================
echo Starting Nexus - Local AI Assistant
echo ====================================================
echo.
echo Make sure Ollama is running in the background!
echo You can run it by typing `ollama serve` in a new terminal if it is not already running.
echo.
echo Opening browser...
start http://localhost:8000

echo Starting local web server...
python -m http.server 8000
