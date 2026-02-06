# Trame Application Startup Guide

## Overview
This is a web application that allows users to login and launch containerized Trame applications with GPU support. Each user gets their own isolated Docker container with access to their personal files.

## Architecture
- **Frontend**: Lit Element web component (port 8000)
- **Backend**: Node.js/Express API (port 8081)
- **Nginx**: Reverse proxy for routing (port 8082)
- **Trame Containers**: Dynamically created per-user containers with GPU support

## Prerequisites
1. Docker Desktop with WSL2 enabled (for Windows)
2. NVIDIA GPU drivers and nvidia-docker runtime
3. Node.js and npm

## First Time Setup

### 1. Build the Trame Image
```bash
cd trame-server
docker build -t trame-slicer -f Dockerfile .
```

### 2. Create Docker Network
```bash
docker network create trame-net
```

### 3. Start Services
```bash
docker-compose up --build
```

This will start:
- Frontend at http://localhost:8000
- Backend API at http://localhost:8081
- Nginx proxy at http://localhost:8082

## How It Works

### User Flow:
1. User visits http://localhost:8082 (nginx proxies to frontend on port 8000)
2. User clicks "Start Trame" button
3. Frontend sends POST request to `/api/jobs/run` with userId
4. Backend:
   - Creates a new Docker container named `trame-{userId}`
   - Mounts user's data directory at `/input`
   - Configures GPU access
   - Generates nginx config for routing to the container
   - Reloads nginx to apply new config
5. Frontend polls the new URL until container is ready
6. User is redirected to their Trame application at `http://localhost:8082/{userId}/`

### File Structure:
```
data/
  users/
    user1/
      input/          # User's files (mounted read-only into container)
nginx/
  default.conf        # Static nginx config
  user1.conf          # Dynamically generated user configs
```

## Configuration

### User ID
Default user is `user1`. To change or add users:
1. Create directory: `data/users/{userId}/input/`
2. Place files in the input directory
3. Update `userId` property in frontend or pass in request

### Scaling
- Current setup: 2-3 users (local dev)
- Target: Up to 100 users
- For production:
  - Use container orchestration (Kubernetes, Docker Swarm)
  - Implement user authentication
  - Add database for tracking active containers
  - Implement container cleanup/timeout policies

## Troubleshooting

### Container spins up but no redirect
**Fixed!** The following issues were resolved:
- ✅ Nginx config directory mounting
- ✅ GPU support in dynamic containers
- ✅ CORS configuration for cross-origin polling
- ✅ API route proxying

### Popup blocked
Allow popups for localhost:8082 in your browser settings

### Container won't start
Check GPU availability:
```bash
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

### Nginx won't reload
Check nginx container logs:
```bash
docker logs nginx
```

## Development Workflow

### Restart Services
```bash
docker-compose down
docker-compose up
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker logs -f backend
docker logs -f nginx
```

### Access Running Container
```bash
docker exec -it trame-user1 /bin/bash
```

## Security Considerations (For Production)

1. **Authentication**: Implement proper user authentication (JWT, OAuth)
2. **File Isolation**: Currently enforced via Docker volumes
3. **Container Limits**: Add CPU/memory limits to prevent resource exhaustion
4. **Network Security**: Use TLS/HTTPS in production
5. **Input Validation**: Validate all user inputs
6. **Container Cleanup**: Implement automatic cleanup of stopped containers
7. **User Quotas**: Limit disk space per user
8. **Access Control**: Ensure users can only access their own containers

## Next Steps for Production

1. Add user authentication system
2. Implement database for user/container tracking
3. Add container lifecycle management (auto-shutdown after timeout)
4. Set up HTTPS with proper certificates
5. Implement resource quotas and monitoring
6. Add logging and analytics
7. Create backup/restore procedures for user data
8. Set up CI/CD pipeline
