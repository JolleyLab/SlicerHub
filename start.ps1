#!/usr/bin/env pwsh
# Simple startup script for the application

Write-Host "Starting Application..." -ForegroundColor Green

# Check if Python is installed
Write-Host "`nChecking Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>$null
if ($?) {
    Write-Host "Python found: $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "Python not found! Please install Python 3.8 or later." -ForegroundColor Red
    Write-Host "Download from: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Check if Docker is installed and running
Write-Host "`nChecking Docker..." -ForegroundColor Yellow
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker is not running. Please start Docker Desktop first!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker is ready!" -ForegroundColor Green
} catch {
    Write-Host "Docker is not installed. Please install Docker Desktop first!" -ForegroundColor Red
    Write-Host "Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Build trame-slicer image if needed
Write-Host "`nChecking trame-slicer Docker image..." -ForegroundColor Yellow
Write-Host "Building trame-slicer image (this may take a few minutes)..." -ForegroundColor Yellow
$buildPath = Join-Path $PSScriptRoot "trame-server"
docker build -t trame-slicer $buildPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build trame-slicer image!" -ForegroundColor Red
    exit 1
}
Write-Host "trame-slicer image built successfully!" -ForegroundColor Green

# Stop any existing processes
Write-Host "`nCleaning up old processes..." -ForegroundColor Yellow
Get-Job | Stop-Job -ErrorAction SilentlyContinue
Get-Job | Remove-Job -ErrorAction SilentlyContinue
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Stop-Process -Name python -Force -ErrorAction SilentlyContinue

# Install/update trame-service dependencies
Write-Host "`nChecking trame-service dependencies..." -ForegroundColor Yellow
$trameServicePath = Join-Path $PSScriptRoot "trame-service"
Push-Location $trameServicePath
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    python -m venv .venv
}
Write-Host "Installing dependencies..." -ForegroundColor Cyan
& ".\.venv\Scripts\pip.exe" install -r requirements.txt -q
Write-Host "Dependencies ready!" -ForegroundColor Green
Pop-Location

# Start Trame Service
Write-Host "`nStarting Trame Visualization Service..." -ForegroundColor Yellow
$trameService = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    $env:USE_GPU = "false"  # No NVIDIA runtime on WSL2/Docker Desktop
    & ".\.venv\Scripts\python.exe" server.py
} -ArgumentList $trameServicePath
Start-Sleep -Seconds 3

# Check trame service started
$trameOutput = Receive-Job $trameService
if ($trameOutput -match "Uvicorn running" -or $trameOutput -match "Application startup complete") {
    Write-Host "Trame service started successfully on port 8090" -ForegroundColor Green
} else {
    Write-Host "Trame service status:" -ForegroundColor Yellow
    if ($trameOutput) { Write-Host $trameOutput }
}

# Start Backend
Write-Host "`nStarting Backend Server..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
$backend = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    $env:TRAME_SERVICE_URL = "http://localhost:8090"
    node ./src/server.js
} -ArgumentList $backendPath
Start-Sleep -Seconds 3

# Check backend started
$backendOutput = Receive-Job $backend
if ($backendOutput -match "Backend listening") {
    Write-Host "Backend started successfully on port 8080" -ForegroundColor Green
} else {
    Write-Host "Backend may have issues. Check output:" -ForegroundColor Red
    Write-Host $backendOutput
}

# Start Frontend
Write-Host "`nStarting Frontend Server..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "dev"
$frontend = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    npx es-dev-server --node-resolve --watch --hostname 0.0.0.0 --port 8000
} -ArgumentList $frontendPath
Start-Sleep -Seconds 3

# Check frontend started
$frontendOutput = Receive-Job $frontend
if ($frontendOutput -match "es-dev-server started") {
    Write-Host "Frontend started successfully on port 8000" -ForegroundColor Green
} else {
    Write-Host "Frontend may have issues. Check output:" -ForegroundColor Red
    Write-Host $frontendOutput
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Application Started!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Frontend:        http://localhost:8000" -ForegroundColor Cyan
Write-Host "Backend API:     http://localhost:8080" -ForegroundColor Cyan
Write-Host "Trame Service:   http://localhost:8090" -ForegroundColor Cyan
Write-Host "`nArchitecture: Backend calls Trame Service -> Spins up Docker containers" -ForegroundColor Yellow
Write-Host "Trame service can be deployed separately to GPU infrastructure" -ForegroundColor Yellow
Write-Host "`nPress Ctrl+C to stop all servers" -ForegroundColor Yellow
Write-Host "================================`n" -ForegroundColor Cyan

# Keep script running and show logs
try {
    while ($true) {
        Start-Sleep -Seconds 5
        $newTrame = Receive-Job $trameService
        $newBackend = Receive-Job $backend
        $newFrontend = Receive-Job $frontend
        if ($newTrame) { Write-Host "[Trame] $newTrame" -ForegroundColor Magenta }
        if ($newBackend) { Write-Host "[Backend] $newBackend" -ForegroundColor Blue }
        if ($newFrontend) { Write-Host "[Frontend] $newFrontend" -ForegroundColor Cyan }
    }
} finally {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    Stop-Process -Name python -Force -ErrorAction SilentlyContinue
    Write-Host "All servers stopped." -ForegroundColor Green
}
