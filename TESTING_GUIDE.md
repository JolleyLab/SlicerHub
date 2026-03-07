# Testing Guide

## Quick Test

1. **Access the application**:
   - Open browser to: http://localhost:8082
   - You should see the Lit Element demo page with "Hello, World!" and a "Start Trame" button

2. **Test the Trame launcher**:
   - Click the "Start Trame" button
   - A new window/tab will open with "Starting Trame… please wait"
   - Backend will:
     - Create a Docker container named `trame-user1`
     - Generate nginx config at `nginx/users/user1.conf`
     - Reload nginx to pick up the new config
   - Frontend will poll http://localhost:8082/user1/ until the Trame app responds
   - You should be redirected to the Trame medical viewer application

3. **Verify container is running**:
   ```powershell
   docker ps --filter name=trame-user1
   ```

4. **Check generated nginx config**:
   ```powershell
   cat nginx\users\user1.conf
   ```

5. **View logs**:
   ```powershell
   # All services
   docker-compose logs -f
   
   # Specific service
   docker logs -f backend
   docker logs -f trame-user1
   docker logs -f nginx
   ```

## What Fixed the Issues

### Issue 1: Nginx Configuration Directory
**Problem**: Backend couldn't write nginx configs because the directory wasn't mounted.
**Solution**: 
- Added `./nginx:/nginx` volume mount to backend container in docker-compose.yml
- Backend now writes to `/nginx/users/{userId}.conf`

### Issue 2: Multiple Server Blocks
**Problem**: Each user config created a separate `server` block listening on port 80, causing conflicts.
**Solution**: 
- Restructured nginx config to use one `server` block with includes
- Dynamic user configs are now `location` blocks in `nginx/users/` directory
- Main `default.conf` includes them with `include /etc/nginx/conf.d/users/*.conf;`

### Issue 3: Frontend Crypto Error
**Problem**: Node.js 18 deprecated old OpenSSL algorithms that es-dev-server relies on.
**Solution**: 
- Added `ENV NODE_OPTIONS=--openssl-legacy-provider` to frontend Dockerfile

## Current Architecture

```
┌─────────────┐
│   Browser   │
│ :8082       │
└──────┬──────┘
       │
┌──────▼──────────────┐
│  Nginx Proxy :80    │
│  (exposed as :8082) │
├─────────────────────┤
│ /           → frontend:8000
│ /api/       → backend:8080
│ /user1/     → trame-user1:8080
│ /user2/     → trame-user2:8080
└─────────────────────┘
       │
   ┌───┴────┬─────────────┐
   ▼        ▼             ▼
┌────────┐ ┌────────┐  ┌──────────────┐
│Frontend│ │Backend │  │Trame Container│
│:8000   │ │:8081   │  │ (per user)   │
└────────┘ └────┬───┘  └──────────────┘
                │
         ┌──────▼───────┐
         │Docker Socket │
         │(creates      │
         │ containers)  │
         └──────────────┘
```

## Directory Structure

```
nginx/
  default.conf          # Main nginx config (static)
  users/                # Dynamic user configs
    user1.conf          # Generated when user1 clicks "Start Trame"
    user2.conf          # Generated when user2 clicks "Start Trame"

data/
  users/
    user1/
      input/            # User1's files (mounted into their container)
    user2/
      input/            # User2's files
```

## Troubleshooting

### Container created but doesn't respond
Check if the trame-slicer image exists:
```powershell
docker images | Select-String trame-slicer
```

If not, build it:
```powershell
cd trame-server
docker build -t trame-slicer -f Dockerfile .
cd ..
```

### Nginx reload fails
Check nginx logs:
```powershell
docker logs nginx --tail 50
```

Verify config syntax:
```powershell
docker exec nginx nginx -t
```

### Backend can't create containers
Check if backend can access Docker socket:
```powershell
docker exec backend ls -la /var/run/docker.sock
```

### Frontend not loading
Check if serving properly:
```powershell
docker logs frontend
```

### GPU not available in container
Verify nvidia-docker runtime:
```powershell
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

## Next Steps

1. Test with actual medical imaging files in `data/users/user1/input/`
2. Add authentication (currently no login required - using hardcoded user1)
3. Implement container cleanup (currently containers auto-remove on exit)
4. Add timeout mechanism (containers run indefinitely)
5. Monitor resource usage
