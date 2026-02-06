#!/usr/bin/env pwsh
# Simple startup script for the application

Write-Host "Starting Application..." -ForegroundColor Green

# Check if Docker is running
Write-Host "`nChecking Docker..." -ForegroundColor Yellow
$dockerRunning = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
if (-not $dockerRunning) {
    Write-Host "Docker Desktop is not running. Please start Docker Desktop first!" -ForegroundColor Red
    Write-Host "After Docker starts, run this script again." -ForegroundColor Yellow
    exit 1
}

# Wait for Docker to be ready
Write-Host "Waiting for Docker to be ready..." -ForegroundColor Yellow
$maxRetries = 30
$retries = 0
while ($retries -lt $maxRetries) {
    $dockerReady = docker info 2>$null
    if ($?) {
        Write-Host "Docker is ready!" -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 1
    $retries++
}

if ($retries -eq $maxRetries) {
    Write-Host "Docker did not start in time. Please check Docker Desktop." -ForegroundColor Red
    exit 1
}

# Create Docker network if it doesn't exist
Write-Host "`nSetting up Docker network..." -ForegroundColor Yellow
docker network create trame-net 2>$null
if ($?) {
    Write-Host "Docker network 'trame-net' created" -ForegroundColor Green
} else {
    Write-Host "Docker network 'trame-net' already exists" -ForegroundColor Cyan
}

# Check if trame-slicer image exists, build if not
Write-Host "`nChecking for trame-slicer Docker image..." -ForegroundColor Yellow
$imageExists = docker images -q trame-slicer 2>$null
if (-not $imageExists) {
    Write-Host "trame-slicer image not found. Building now..." -ForegroundColor Yellow
    Write-Host "This may take several minutes on first run..." -ForegroundColor Cyan
    
    $buildPath = Join-Path $PSScriptRoot "trame-server"
    docker build -t trame-slicer $buildPath
    
    if ($?) {
        Write-Host "trame-slicer image built successfully!" -ForegroundColor Green
    } else {
        Write-Host "Failed to build trame-slicer image. Check Docker logs." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "trame-slicer image found!" -ForegroundColor Green
}

# Stop any existing jobs
Write-Host "`nCleaning up old processes..." -ForegroundColor Yellow
Get-Job | Stop-Job -ErrorAction SilentlyContinue
Get-Job | Remove-Job -ErrorAction SilentlyContinue
Stop-Process -Name node -Force -ErrorAction SilentlyContinue

# Start Backend
Write-Host "`nStarting Backend Server..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
$backend = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
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
Write-Host "Frontend: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8080" -ForegroundColor Cyan
Write-Host "`nPress Ctrl+C to stop all servers" -ForegroundColor Yellow
Write-Host "================================`n" -ForegroundColor Cyan

# Keep script running and show logs
try {
    while ($true) {
        Start-Sleep -Seconds 5
        $newBackend = Receive-Job $backend
        $newFrontend = Receive-Job $frontend
        if ($newBackend) { Write-Host "[Backend] $newBackend" }
        if ($newFrontend) { Write-Host "[Frontend] $newFrontend" }
    }
} finally {
    Write-Host "`nStopping servers..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    Write-Host "Servers stopped." -ForegroundColor Green
}
