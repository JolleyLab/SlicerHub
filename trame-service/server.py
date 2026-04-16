"""
Trame Visualization Service - Manages multiple concurrent Trame sessions.

The GPU backend is pluggable via the GPU_PROVIDER environment variable:
    GPU_PROVIDER=docker    (default) Docker containers on a local/VM daemon
    GPU_PROVIDER=vastai    vast.ai on-demand GPU marketplace instances

All provider-specific logic lives in trame-service/providers/.
This file only deals with HTTP routing, session lifecycle, and saves.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn
import os
import subprocess
import time
import asyncio
import aiohttp
import datetime
from typing import Dict, Optional, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track active sessions: session_id -> SessionInfo
from providers.base import SessionInfo
active_sessions: Dict[str, SessionInfo] = {}
# Per-session extra metadata not on SessionInfo
session_meta: Dict[str, dict] = {}  # session_id -> {last_activity, original_file_name, parent_file_id}

# Auto-shutdown configuration (default: 15 minutes)
IDLE_SHUTDOWN_MINUTES = int(os.getenv('IDLE_SHUTDOWN_MINUTES', '15'))

# Mock mode - set MOCK_TRAME=true to skip real Docker/Slicer for local testing
MOCK_TRAME = os.getenv('MOCK_TRAME', 'false').lower() in ('true', '1', 'yes')

# Provider selection
GPU_PROVIDER = os.getenv('GPU_PROVIDER', 'docker').lower()
if not MOCK_TRAME:
    if GPU_PROVIDER == 'vastai':
        from providers.vastai_provider import VastAiProvider
        provider = VastAiProvider()
        logger.info("GPU provider: vast.ai")
    elif GPU_PROVIDER == 'paperspace':
        from providers.paperspace_provider import PaperspaceProvider
        provider = PaperspaceProvider()
        logger.info("GPU provider: Paperspace (remote VM)")
    else:
        from providers.docker_provider import DockerProvider
        provider = DockerProvider()
        logger.info("GPU provider: Docker")
else:
    provider = None
    logger.info("GPU provider: MOCK (no real sessions)")



def check_docker_available() -> bool:
    """Check if Docker is available (only relevant for Docker provider)"""
    try:
        result = subprocess.run(
            ['docker', 'version', '--format', '{{.Server.Version}}'],
            capture_output=True, text=True, check=False
        )
        if result.returncode == 0:
            logger.info(f"Docker available, version: {result.stdout.strip()}")
            return True
        logger.error(f"Docker check failed: {result.stderr}")
        return False
    except Exception as e:
        logger.error(f"Docker check failed: {e}")
        return False


async def check_idle_sessions():
    """Check for idle sessions and shut them down"""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute

            current_time = time.time()
            idle_threshold = IDLE_SHUTDOWN_MINUTES * 60

            for session_id, session_info in list(active_sessions.items()):
                meta = session_meta.get(session_id, {})
                idle_time = current_time - meta.get('last_activity', current_time)

                if idle_time > idle_threshold:
                    logger.info(f"Session {session_id} idle for {idle_time/60:.1f} minutes, shutting down")
                    if provider:
                        await provider.stop_session(session_info)
                    del active_sessions[session_id]
                    session_meta.pop(session_id, None)

        except Exception as e:
            logger.error(f"Error in idle session check: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown"""
    logger.info(f"Trame service starting (provider={GPU_PROVIDER}, mock={MOCK_TRAME})")

    if GPU_PROVIDER == 'docker' and not MOCK_TRAME:
        if not check_docker_available():
            logger.error("Docker is not available!")

    checker_task = asyncio.create_task(check_idle_sessions())

    yield

    logger.info("Shutting down — cleaning up sessions")
    checker_task.cancel()
    for session_id, session_info in list(active_sessions.items()):
        try:
            if provider:
                await provider.stop_session(session_info)
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
    originalFileName: Optional[str] = None  # Original file name for overwrite-save
    parentFileId: Optional[int] = None  # DB file ID of the launched file, for parent linking


class SessionResponse(BaseModel):
    sessionId: str
    port: int
    wsUrl: str
    userId: str
    containerName: str


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    if GPU_PROVIDER == 'docker' and not MOCK_TRAME:
        docker_ok = check_docker_available()
        backend_status = "available" if docker_ok else "unavailable"
        healthy = docker_ok
    else:
        backend_status = GPU_PROVIDER
        healthy = True
    return {
        "status": "healthy" if healthy else "degraded",
        "provider": GPU_PROVIDER,
        "backend": backend_status,
        "mock": MOCK_TRAME,
        "active_sessions": len(active_sessions)
    }


@app.post("/api/sessions/start", response_model=SessionResponse)
async def start_session(request: StartSessionRequest):
    """Start a new Trame visualization session"""

    user_id = request.userId
    file_path = request.filePath
    file_name = os.path.basename(file_path) if file_path else None
    session_id = f"trame-{user_id}-{int(time.time())}"

    # Stop any existing session for this user
    for existing_id, existing_info in list(active_sessions.items()):
        if existing_info.user_id == user_id:
            logger.info(f"Stopping existing session {existing_id} for user {user_id}")
            try:
                if provider:
                    await provider.stop_session(existing_info)
                del active_sessions[existing_id]
                session_meta.pop(existing_id, None)
            except Exception as e:
                logger.error(f"Error stopping existing session: {e}")

    # Port hint for Docker provider (vast.ai ignores this)
    used_ports = {s.port for s in active_sessions.values()}
    port_hint = next((p for p in range(9000, 9010) if p not in used_ports), None)
    if port_hint is None:
        raise HTTPException(status_code=503, detail="No available ports")

    # Build user files path
    workspace_root = os.getenv('WORKSPACE_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    user_files_path = os.path.join(workspace_root, "backend", "userFiles", user_id)
    os.makedirs(user_files_path, exist_ok=True)

    if MOCK_TRAME:
        from providers.base import SessionInfo
        container_name = f"trame-session-{user_id}"
        logger.info(f"[MOCK] Simulating session start for user {user_id} on port {port_hint}")
        mock_info = SessionInfo(
            session_id=session_id,
            container_id='mock-container-id',
            container_name=container_name,
            host='localhost',
            port=port_hint,
            user_id=user_id,
            original_file_name=request.originalFileName,
            parent_file_id=request.parentFileId,
        )
        active_sessions[session_id] = mock_info
        session_meta[session_id] = {
            'last_activity': time.time(),
            'original_file_name': request.originalFileName,
            'parent_file_id': request.parentFileId,
        }
        return SessionResponse(
            sessionId=session_id,
            port=port_hint,
            wsUrl=f"ws://localhost:{port_hint}/ws",
            userId=user_id,
            containerName=container_name,
        )

    try:
        session_info = await provider.start_session(
            user_id=user_id,
            session_id=session_id,
            port_hint=port_hint,
            user_files_host_path=user_files_path,
            file_name=file_name,
            original_file_name=request.originalFileName,
            parent_file_id=request.parentFileId,
        )

        # Wait for trame HTTP server to be ready
        ready = await provider.is_ready(session_info)
        if not ready:
            await provider.stop_session(session_info)
            raise HTTPException(status_code=503, detail="Trame session did not become ready in time")

        active_sessions[session_id] = session_info
        session_meta[session_id] = {
            'last_activity': time.time(),
            'original_file_name': request.originalFileName,
            'parent_file_id': request.parentFileId,
        }

        logger.info(f"Started session {session_id} for user {user_id} @ {session_info.host}:{session_info.port}")
        return SessionResponse(
            sessionId=session_id,
            port=session_info.port,
            wsUrl=f"ws://{session_info.host}:{session_info.port}/ws",
            userId=user_id,
            containerName=session_info.container_name,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")


@app.post("/api/sessions/{session_id}/save")
async def save_session(session_id: str, overwrite: bool = False):
    """Save the current Slicer scene to an MRB file.
    If overwrite=true, saves using the original file's base name.
    Otherwise creates a new timestamped file.
    For vast.ai sessions the saved file is SCP'd back to the CPU VM."""

    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session_info = active_sessions[session_id]
    meta = session_meta.get(session_id, {})
    user_id = session_info.user_id

    # Determine output filename
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    orig = meta.get('original_file_name') or session_info.original_file_name
    if overwrite and orig:
        base = os.path.splitext(orig)[0]
        save_filename = f"{base}.mrb"
    elif orig:
        base = os.path.splitext(orig)[0]
        save_filename = f"{base}_{timestamp}.mrb"
    else:
        save_filename = f"session_{timestamp}.mrb"

    container_save_path = f"/data/{save_filename}"

    workspace_root = os.getenv('WORKSPACE_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    host_save_dir = os.path.join(workspace_root, "backend", "userFiles", user_id)
    os.makedirs(host_save_dir, exist_ok=True)
    host_save_path = os.path.join(host_save_dir, save_filename)

    try:
        if MOCK_TRAME:
            logger.info(f"[MOCK] Simulating scene save for session {session_id}")
            with open(host_save_path, 'wb') as f:
                f.write(b'PK\x03\x04')  # Minimal ZIP/MRB header
            session_meta[session_id]['last_activity'] = time.time()
            return {"status": "saved", "filename": save_filename, "userId": user_id,
                    "parentFileId": meta.get('parent_file_id')}

        # Ask the trame server inside the session to save the scene
        async with aiohttp.ClientSession() as client:
            resp = await client.post(
                f"http://{session_info.host}:{session_info.port}/trigger",
                json={"name": "save_scene", "args": [container_save_path]},
                timeout=aiohttp.ClientTimeout(total=60)
            )
            if resp.status not in (200, 204):
                body = await resp.text()
                raise HTTPException(status_code=502, detail=f"Trame save failed: {body}")

        # For remote providers (vast.ai, paperspace), SCP the saved file back to the CPU VM
        if GPU_PROVIDER in ('vastai', 'paperspace') and provider:
            await provider.download_file(session_info, save_filename, host_save_path)

        logger.info(f"Scene saved to {container_save_path} for session {session_id}")
        session_meta[session_id]['last_activity'] = time.time()
        return {"status": "saved", "filename": save_filename, "userId": user_id,
                "parentFileId": meta.get('parent_file_id')}

    except aiohttp.ClientError as e:
        logger.error(f"Failed to call trame save: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach trame session: {str(e)}")


@app.post("/api/sessions/{session_id}/stop")
async def stop_session(session_id: str):
    """Stop a Trame visualization session"""

    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        session_info = active_sessions[session_id]
        if provider:
            await provider.stop_session(session_info)
        del active_sessions[session_id]
        session_meta.pop(session_id, None)

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

    session_meta[session_id]['last_activity'] = time.time()
    return {"status": "ok"}


@app.get("/api/sessions")
async def list_sessions():
    """List all active sessions"""
    return {
        "sessions": [
            {
                "sessionId": sid,
                "userId": s.user_id,
                "host": s.host,
                "port": s.port,
                "provider": GPU_PROVIDER,
                "idleMinutes": (time.time() - session_meta.get(sid, {}).get('last_activity', time.time())) / 60
            }
            for sid, s in active_sessions.items()
        ]
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port)
