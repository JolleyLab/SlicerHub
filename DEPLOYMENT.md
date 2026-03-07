# Deployment Guide

This document provides instructions for deploying the Medical Imaging Viewer application to different environments.

## Development Environment

The application is pre-configured for local development with default settings:

- **Frontend**: http://localhost:8000
- **Backend API**: http://localhost:8080
- **Trame Server**: http://localhost:8000

To start the application in development mode:

```powershell
.\start.ps1
```

This script will:
1. Check if Docker images exist and build them if needed
2. Start the backend server on port 8080
3. Start the frontend dev server on port 8000
4. Monitor both processes

## Production Deployment

### Environment Configuration

The application uses centralized configuration in `dev/config.js` to support different deployment environments.

#### Configuration Variables

- **API_URL**: Base URL for the backend API (default: `http://localhost:8080`)
- **TRAME_URL**: Base URL for the Trame server (default: `http://localhost:8000`)

### Option 1: Environment Variables (Recommended)

For production deployments, set environment variables before bundling/building the frontend:

```powershell
# Windows
$env:API_URL = "https://api.yourcompany.com"
$env:TRAME_URL = "https://trame.yourcompany.com"

# Linux/Mac
export API_URL="https://api.yourcompany.com"
export TRAME_URL="https://trame.yourcompany.com"
```

### Option 2: Direct Configuration Modification

For simple deployments, you can directly edit `dev/config.js`:

```javascript
export const API_URL = 'https://api.yourcompany.com';
export const TRAME_URL = 'https://trame.yourcompany.com';
```

## Backend Configuration

The backend uses `config/index.js` for environment-specific settings:

```javascript
module.exports = {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-key',
    jwtExpiration: process.env.JWT_EXPIRATION || '24h',
    // ... other settings
};
```

For production, **always** set these environment variables:

```powershell
# Windows
$env:JWT_SECRET = "your-secure-random-secret-key"
$env:NODE_ENV = "production"

# Linux/Mac
export JWT_SECRET="your-secure-random-secret-key"
export NODE_ENV="production"
```

## Docker Deployment

### Required Docker Images

The application requires three Docker images:

1. **trame-medical-viewer**: Medical imaging viewer application
2. **Backend**: Node.js API server (optional for containerized deployment)
3. **Frontend**: Web server for static files (optional for containerized deployment)

### Building Images

Images are automatically built by `start.ps1`, or you can build manually:

```powershell
# Build Trame image
cd trame-server
docker build -t trame-medical-viewer .

# Build backend (if deploying as container)
cd backend
docker build -t medical-viewer-backend .

# Build frontend (if deploying as container)
cd dev
docker build -t medical-viewer-frontend .
```

### Docker Compose

For a complete containerized deployment, refer to `docker-compose.yml` (if available) or create one:

```yaml
version: '3.8'
services:
  backend:
    image: medical-viewer-backend
    ports:
      - "8080:8080"
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    volumes:
      - ./userFiles:/app/userFiles
      - ./backend/data:/app/data

  frontend:
    image: medical-viewer-frontend
    ports:
      - "80:8000"
    environment:
      - API_URL=${API_URL}
      - TRAME_URL=${TRAME_URL}
```

## Port Configuration

Default ports can be modified in:

- **Backend**: `backend/src/index.js` or via `PORT` environment variable
- **Frontend**: Development server configuration
- **Trame**: Launched dynamically by backend, uses available ports

## File Storage

User uploaded files are stored in:
- **Development**: `backend/userFiles/`
- **Production**: Configure via volume mounts or cloud storage

Ensure the storage directory has proper permissions and backup policies in production.

## Database

The application uses SQLite for development:
- **Location**: `backend/data/users.db`

For production, consider:
- Using a managed SQLite solution with proper backups
- Migrating to PostgreSQL/MySQL for multi-instance deployments

## Security Considerations

### Required for Production

1. **JWT Secret**: Set a strong, random secret key
   ```powershell
   $env:JWT_SECRET = "$(New-Guid)-$(New-Guid)"
   ```

2. **HTTPS**: Always use HTTPS in production
   - Update API_URL to use `https://`
   - Configure SSL certificates on your web server

3. **CORS**: Configure allowed origins in backend
   ```javascript
   app.use(cors({
       origin: 'https://yourfrontend.com',
       credentials: true
   }));
   ```

4. **Cookie Security**: Ensure cookies use secure settings (already configured in code)

5. **File Upload Limits**: Review and adjust based on your needs (currently 500MB)

## Container Cleanup

The application automatically cleans up Docker containers when:
- User logs out
- Browser tab is closed
- 30 minutes of inactivity detected

Cleanup intervals are configured in `backend/src/routes/containers.js`:
- **Cleanup Check**: Every 5 minutes
- **Inactivity Timeout**: 30 minutes

## Monitoring

Consider implementing:
- Container lifecycle logging
- File upload/download metrics
- User session tracking
- Error reporting (e.g., Sentry)

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```powershell
   # Stop existing Node processes
   Get-Process -Name node | Stop-Process -Force
   ```

2. **Docker Image Not Found**
   ```powershell
   # Rebuild images
   cd trame-server
   docker build -t trame-medical-viewer .
   ```

3. **Database Connection Issues**
   ```powershell
   # Reset database (development only)
   Remove-Item backend/data/users.db -Force
   ```

4. **CORS Errors**
   - Verify API_URL matches your backend URL
   - Check CORS configuration in backend

## System Requirements

- **Node.js**: 14.x or higher
- **Docker**: 20.x or higher
- **PowerShell**: 5.1 or higher (Windows)
- **Disk Space**: Minimum 10GB for Docker images and user files
- **RAM**: Minimum 4GB recommended

## Support

For issues or questions:
1. Check container logs: `docker logs <container-name>`
2. Review backend logs: Check terminal output from `start.ps1`
3. Verify environment variables are set correctly
4. Ensure all Docker images are built successfully
