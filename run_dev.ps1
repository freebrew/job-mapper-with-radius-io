#!/usr/bin/env pwsh
# JobRadius - Windows Development Launcher

$Env:NODE_ENV = "development"
Write-Host "============================================================"
Write-Host " JOBRADIUS WIZARD  |  Run ID: $(New-Guid)"
Write-Host " Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "============================================================"
Write-Host "Starting JobRadius Development Servers..."

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "[STEP 1/2] Installing dependencies..."
    npm install
}
else {
    Write-Host "[STEP 1/2] Dependencies found."
}

Write-Host "[STEP 2/2] Starting Backend (port 3000) + Vite Frontend (port 5173)..."
npx concurrently --names "SERVER,CLIENT" --prefix-colors "cyan,magenta" "npx nodemon src/server/index.js" "npx vite --config vite.config.js"
