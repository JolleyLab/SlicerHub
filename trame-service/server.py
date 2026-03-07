"""
Trame Visualization Service - Manages multiple concurrent Trame sessions using Docker
Uses subprocess to call Docker CLI directly (more reliable on Windows than docker-py)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn
import os
import subprocess
import json
import time
import asyncio
from typing import Dict, Optional, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track active sessions: session_id -> {container_id, container_name, port, user_id, last_activity}
active_sessions: Dict[str, dict] = {}

# Auto-shutdown configuration (default: 15 minutes)
IDLE_SHUTDOWN_MINUTES = int(os.getenv('IDLE_SHUTDOWN_MINUTES', '15'))

# GPU support - set USE_GPU=false to disable for local testing without NVIDIA container runtime
USE_GPU = os.getenv('USE_GPU', 'true').lower() not in ('false', '0', 'no')


def run_docker(args: List[str], check=True) -> subprocess.CompletedProcess:
    """Run a docker CLI command"""
    try:
        cmd = ['docker'] + args
        logger.debug(f"Running: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=check)
        return result
    except subprocess.CalledProcessError as e:
        logger.error(f"Docker command failed: {e.stderr}")
        raise
    except FileNotFoundError:
        raise RuntimeError("Docker CLI not found. Ensure Docker is installed.")


def check_docker_available() -> bool:
    """Check if Docker is available"""
    try:
        result = run_docker(['version', '--format', '{{.Server.Version}}'], check=False)
        if result.returncode == 0:
            logger.info(f"Docker available, version: {result.stdout.strip()}")
            return True
        logger.error(f"Docker check failed: {result.stderr}")
        return False
    except Exception as e:
        logger.error(f"Docker check failed: {e}")
        return False


def get_running_containers() -> List[dict]:
    """Get list of running containers managed by this service"""
    try:
        result = run_docker([
            'ps',
            '--filter', 'label=trame-service=true',
            '--format', '{{json .}}'
        ], check=False)
        
        if result.returncode != 0:
            return []
        
        containers = []
        for line in result.stdout.strip().split('\n'):
            if line:
                containers.append(json.loads(line))
        return containers
    except Exception as e:
        logger.error(f"Error listing containers: {e}")
        return []


def stop_container(container_id: str):
    """Stop and remove a container"""
    try:
        logger.info(f"Stopping container {container_id}")
        run_docker(['stop', container_id], check=False)
        run_docker(['rm', container_id], check=False)
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {e}")


async def check_idle_containers():
    """Check for idle containers and shut them down"""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            
            current_time = time.time()
            idle_threshold = IDLE_SHUTDOWN_MINUTES * 60
            
            for session_id, session in list(active_sessions.items()):
                idle_time = current_time - session.get('last_activity', current_time)
                
                if idle_time > idle_threshold:
                    logger.info(f"Session {session_id} idle for {idle_time/60:.1f} minutes, shutting down")
                    stop_container(session['container_id'])
                    del active_sessions[session_id]
                    
        except Exception as e:
            logger.error(f"Error in idle container check: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown"""
    logger.info("Trame service starting")
    
    # Check Docker availability
    if not check_docker_available():
        logger.error("Docker is not available!")
    
    # Start idle container checker
    import asyncio
    checker_task = asyncio.create_task(check_idle_containers())
    
    yield
    
    # Cleanup on shutdown
    logger.info("Shutting down - cleaning up containers")
    checker_task.cancel()
    for session_id in list(active_sessions.keys()):
        try:
            stop_container(active_sessions[session_id]['container_id'])
        except Exception as e:
            logger.error(f"Error cleaning up session {session_id}: {e}")


app = FastAPI(title="Trame Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartSessionRequest(BaseModel):
    userId: str
    filePath: Optional[str] = None


class SessionResponse(BaseModel):
    sessionId: str
    port: int
    wsUrl: str


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    docker_ok = check_docker_available()
    return {
        "status": "healthy" if docker_ok else "degraded",
        "docker": "available" if docker_ok else "unavailable",
        "active_sessions": len(active_sessions)
    }


@app.post("/api/sessions/start", response_model=SessionResponse)
async def start_session(request: StartSessionRequest):
    """Start a new Trame visualization session"""
    
    if not check_docker_available():
        raise HTTPException(status_code=503, detail="Docker is not available")
    
    user_id = request.userId
    file_path = request.filePath
    session_id = f"trame-{user_id}-{int(time.time())}"
    
    # Check if user already has an active session - stop it to load new file
    for existing_id, session in list(active_sessions.items()):
        if session['user_id'] == user_id:
            logger.info(f"Stopping existing session {existing_id} to start new one for user {user_id}")
            try:
                stop_container(session['container_id'])
                del active_sessions[existing_id]
            except Exception as e:
                logger.error(f"Error stopping existing session: {e}")
    
    # Find available port (9000-9009)
    used_ports = {s['port'] for s in active_sessions.values()}
    port = None
    for p in range(9000, 9010):
        if p not in used_ports:
            port = p
            break
    
    if port is None:
        raise HTTPException(status_code=503, detail="No available ports")
    
    # Build paths
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    user_files_path = os.path.join(workspace_root, "backend", "userFiles", user_id)
    os.makedirs(user_files_path, exist_ok=True)
    
    # Convert Windows path to Docker-compatible path
    user_files_path = user_files_path.replace('\\', '/')
    if ':' in user_files_path:
        # Convert C:/path to /c/path for Docker
        drive, path = user_files_path.split(':', 1)
        user_files_path = f"/{drive.lower()}{path}"
    
    container_name = f"trame-session-{user_id}"
    
    try:
        # Remove any existing container with the same name
        logger.info(f"Cleaning up any existing container named {container_name}")
        run_docker(['rm', '-f', container_name], check=False)
        
        # Build docker run command
        docker_cmd = [
            'run',
            '-d',
            '--name', container_name,
            '--label', 'trame-service=true',
            '--label', f'user={user_id}',
            '-p', f'{port}:9000',
            '-v', f'{user_files_path}:/data',
            '-e', f'USER_ID={user_id}',
            '-e', 'VTK_DEFAULT_OPENGL_WINDOW=vtkEGLRenderWindow',
        ]

        # Add GPU support if available (set USE_GPU=false for local testing without NVIDIA runtime)
        if USE_GPU:
            docker_cmd.extend(['--gpus', 'all'])
        
        # Add file path as environment variable if provided
        if file_path:
            # File path should be relative to /data mount point
            file_name = os.path.basename(file_path)
            docker_cmd.extend(['-e', f'FILE_PATH=/data/{file_name}'])
        
        docker_cmd.append('trame-slicer')
        
        # Start container
        logger.info(f"Starting container {container_name} on port {port}" + (f" with file {file_path}" if file_path else ""))
        
        result = run_docker(docker_cmd)
        
        container_id = result.stdout.strip()
        
        # Store session info
        active_sessions[session_id] = {
            'container_id': container_id,
            'container_name': container_name,
            'port': port,
            'user_id': user_id,
            'last_activity': time.time()
        }
        
        logger.info(f"Started session {session_id} for user {user_id} on port {port}")
        
        return SessionResponse(
            sessionId=session_id,
            port=port,
            wsUrl=f"ws://localhost:{port}/ws"
        )
        
    except Exception as e:
        logger.error(f"Failed to start container: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")


@app.post("/api/sessions/{session_id}/stop")
async def stop_session(session_id: str):
    """Stop a Trame visualization session"""
    
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        session = active_sessions[session_id]
        stop_container(session['container_id'])
        del active_sessions[session_id]
        
        logger.info(f"Stopped session {session_id}")
        return {"status": "stopped", "sessionId": session_id}
        
    except Exception as e:
        logger.error(f"Failed to stop session {session_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop session: {str(e)}")


@app.post("/api/sessions/{session_id}/heartbeat")
async def heartbeat(session_id: str):
    """Update session activity timestamp"""
    
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    active_sessions[session_id]['last_activity'] = time.time()
    return {"status": "ok"}


@app.get("/api/sessions")
async def list_sessions():
    """List all active sessions"""
    return {
        "sessions": [
            {
                "sessionId": sid,
                "userId": s['user_id'],
                "port": s['port'],
                "idleMinutes": (time.time() - s['last_activity']) / 60
            }
            for sid, s in active_sessions.items()
        ]
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port)
