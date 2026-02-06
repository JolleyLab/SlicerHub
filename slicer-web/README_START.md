# Quick Start Guide

## Prerequisites
1. **Docker Desktop** must be installed and running
2. **Node.js** must be installed

## Starting the Application

### Windows (PowerShell)
```powershell
.\start.ps1
```

### Manual Start (if script doesn't work)

**Terminal 1 - Backend:**
```bash
cd backend
node ./src/docker/launch.js
```

**Terminal 2 - Frontend:**
```bash
cd dev
npx es-dev-server --node-resolve --watch --hostname 0.0.0.0 --port 8000
```

**Terminal 3 - Docker Network (one-time setup):**
```bash
docker network create trame-net
```

## Accessing the Application

- **Frontend**: http://localhost:8000
- **Backend API**: http://localhost:8080

## First Time Setup

1. Start Docker Desktop
2. Run `.\start.ps1`
3. Open http://localhost:8000
4. Click "Register here" to create your first user account
5. After registration, you'll be automatically logged in

## Troubleshooting

### "Docker Desktop is not running"
- Start Docker Desktop and wait for it to fully load
- Look for the Docker whale icon in your system tray
- Run the script again

### "Network trame-net not found"
```bash
docker network create trame-net
```

### Port already in use
```powershell
# Stop all node processes
Get-Process -Name node | Stop-Process -Force

# Then restart the application
.\start.ps1
```

### Database issues
If you see authentication errors, reset the database:
```powershell
Remove-Item backend\data\users.db -Force
```
Then restart the application.

## Stopping the Application

Press `Ctrl+C` in the PowerShell window running `start.ps1`

Or manually:
```powershell
Get-Process -Name node | Stop-Process -Force
```
