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
import socket
from typing import Dict, Optional, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track active sessions: session_id -> {container_id, container_name, port, user_id,
#   last_activity, started_at, lease_expires_at}
active_sessions: Dict[str, dict] = {}


def _session_ttl_seconds() -> int:
    """Sliding lease: session is stopped if no heartbeat/activity extends the lease."""
    raw = (os.getenv("SESSION_TTL_SECONDS") or "").strip()
    if raw:
        return max(60, int(raw))
    idle_min = (os.getenv("IDLE_SHUTDOWN_MINUTES") or "").strip()
    if idle_min:
        return max(60, int(idle_min) * 60)
    return 1800  # default 30 minutes


def _max_session_wall_seconds() -> int:
    """Hard cap on wall-clock session length (0 = disabled). Heartbeat cannot extend past this."""
    raw = (os.getenv("MAX_SESSION_WALL_SECONDS") or "28800").strip()
    if not raw or raw == "0":
        return 0
    return max(60, int(raw))


SESSION_TTL_SECONDS = _session_ttl_seconds()
MAX_SESSION_WALL_SECONDS = _max_session_wall_seconds()
PRUNE_EXITED_INTERVAL_SECONDS = int(os.getenv("PRUNE_EXITED_INTERVAL_SECONDS", "300"))

# GPU support - set USE_GPU=false to disable for local testing without NVIDIA container runtime
USE_GPU = os.getenv('USE_GPU', 'true').lower() not in ('false', '0', 'no')
TRAME_IMAGE = (os.getenv('TRAME_IMAGE') or 'slicer-web-trame:local').strip() or 'slicer-web-trame:local'


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


def trame_image_inspect() -> dict:
    """Return whether TRAME_IMAGE exists locally and basic metadata (for /health and startup)."""
    r = run_docker(
        [
            'image', 'inspect', TRAME_IMAGE,
            '--format', '{{.Id}}\t{{.Created}}\t{{json .RepoTags}}',
        ],
        check=False,
    )
    if r.returncode != 0:
        return {
            'present': False,
            'id': None,
            'created': None,
            'repo_tags': [],
            'inspect_error': (r.stderr or r.stdout or '').strip(),
        }
    parts = (r.stdout or '').strip().split('\t', 2)
    img_id = parts[0] if parts else None
    created = parts[1] if len(parts) > 1 else None
    tags_raw = parts[2] if len(parts) > 2 else '[]'
    try:
        repo_tags = json.loads(tags_raw) if tags_raw else []
    except json.JSONDecodeError:
        repo_tags = [tags_raw] if tags_raw else []
    return {
        'present': True,
        'id': img_id,
        'created': created,
        'repo_tags': repo_tags,
        'inspect_error': None,
    }


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
    """Stop and remove a container (single rm -f avoids stopped-but-not-deleted leftovers)."""
    try:
        logger.info(f"Removing container {container_id}")
        r = run_docker(["rm", "-f", container_id], check=False)
        if r.returncode != 0:
            logger.warning(
                "docker rm -f %s exited %s stderr=%s stdout=%s",
                container_id,
                r.returncode,
                (r.stderr or "").strip(),
                (r.stdout or "").strip(),
            )
    except Exception as e:
        logger.error(f"Error removing container {container_id}: {e}")


def touch_session_activity(session_id: str) -> Optional[float]:
    """Extend sliding lease; returns new lease_expires_at epoch seconds, or None if unknown session."""
    if session_id not in active_sessions:
        return None
    session = active_sessions[session_id]
    now = time.time()
    session["last_activity"] = now
    lease_end = now + SESSION_TTL_SECONDS
    if MAX_SESSION_WALL_SECONDS > 0:
        wall_end = session.get("started_at", now) + MAX_SESSION_WALL_SECONDS
        lease_end = min(lease_end, wall_end)
    session["lease_expires_at"] = lease_end
    return lease_end


def prune_stopped_trame_containers():
    """Remove stopped session containers left behind after crashes or partial cleanups."""
    try:
        r = run_docker(
            ["container", "prune", "-f", "--filter", "label=trame-service=true"],
            check=False,
        )
        out = (r.stdout or "").strip().replace("\n", " ")
        if out:
            logger.info("Trame container prune: %s", out)
    except Exception as e:
        logger.error(f"Trame container prune failed: {e}")


def is_container_port_open(container_name: str, port: int, timeout_seconds: float = 1.0) -> bool:
    """Check if a container is accepting TCP connections on the given port."""
    try:
        with socket.create_connection((container_name, port), timeout=timeout_seconds):
            return True
    except (OSError, socket.timeout):
        return False


async def wait_for_container_ready(container_name: str, port: int, max_wait_seconds: int = 60) -> bool:
    """Wait until the container starts accepting connections on the expected port."""
    deadline = time.time() + max_wait_seconds
    while time.time() < deadline:
        if is_container_port_open(container_name, port):
            return True
        await asyncio.sleep(1)
    return False


async def enforce_session_leases():
    """Stop sessions whose sliding lease expired (no recent heartbeat / activity)."""
    while True:
        try:
            await asyncio.sleep(60)
            now = time.time()
            for session_id, session in list(active_sessions.items()):
                lease_end = session.get("lease_expires_at")
                if lease_end is None or now >= lease_end:
                    idle_min = (now - session.get("last_activity", now)) / 60.0
                    logger.info(
                        "Session %s lease expired (last activity %.1f min ago), removing container",
                        session_id,
                        idle_min,
                    )
                    stop_container(session["container_id"])
                    del active_sessions[session_id]
        except Exception as e:
            logger.error(f"Error in session lease enforcement: {e}")


async def prune_exited_trame_loop():
    while True:
        try:
            await asyncio.sleep(max(60, PRUNE_EXITED_INTERVAL_SECONDS))
            prune_stopped_trame_containers()
        except Exception as e:
            logger.error(f"Error in trame prune loop: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown"""
    logger.info("Trame service starting")
    img = trame_image_inspect()
    logger.info(
        "TRAME_IMAGE=%s present=%s id=%s created=%s repo_tags=%s",
        TRAME_IMAGE,
        img.get('present'),
        (img.get('id') or '')[:12] if img.get('id') else None,
        img.get('created'),
        img.get('repo_tags'),
    )
    if not img.get('present'):
        logger.error(
            "TRAME_IMAGE %s is not on this Docker host — session starts will fail until you "
            "`docker compose build trame-job` (same TRAME_IMAGE in compose/.env) and "
            "`docker compose up -d --force-recreate trame-service`. Inspect error: %s",
            TRAME_IMAGE,
            img.get('inspect_error'),
        )
    
    # Check Docker availability
    if not check_docker_available():
        logger.error("Docker is not available!")

    lease_task = asyncio.create_task(enforce_session_leases())
    prune_task = asyncio.create_task(prune_exited_trame_loop())
    prune_stopped_trame_containers()
    logger.info(
        "Session lease: ttl=%ss wall_cap=%ss prune_interval=%ss",
        SESSION_TTL_SECONDS,
        MAX_SESSION_WALL_SECONDS or "none",
        PRUNE_EXITED_INTERVAL_SECONDS,
    )

    yield

    # Cleanup on shutdown
    logger.info("Shutting down - cleaning up containers")
    lease_task.cancel()
    prune_task.cancel()
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
    viewState: Optional[dict] = None


class SessionResponse(BaseModel):
    sessionId: str
    port: int
    wsUrl: str
    userId: str
    containerName: str


class SaveSessionRequest(BaseModel):
    targetFileName: Optional[str] = None


class ApplyViewStateRequest(BaseModel):
    viewState: dict


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    docker_ok = check_docker_available()
    img = trame_image_inspect()
    return {
        "status": "healthy" if docker_ok else "degraded",
        "docker": "available" if docker_ok else "unavailable",
        "active_sessions": len(active_sessions),
        "trameImage": TRAME_IMAGE,
        "trameImagePresent": img.get("present", False),
        "trameImageId": img.get("id"),
        "trameImageCreated": img.get("created"),
        "trameRepoTags": img.get("repo_tags"),
    }


@app.post("/api/sessions/start", response_model=SessionResponse)
async def start_session(request: StartSessionRequest):
    """Start a new Trame visualization session"""
    
    if not check_docker_available():
        raise HTTPException(status_code=503, detail="Docker is not available")

    img = trame_image_inspect()
    if not img.get("present"):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Docker image not found: {TRAME_IMAGE}. "
                "Build the session image on this host (same name as compose `trame-job.image`) "
                "and recreate trame-service: `docker compose build trame-job && "
                "docker compose up -d --force-recreate trame-service`. "
                f"Docker said: {img.get('inspect_error') or 'unknown'}"
            ),
        )
    
    user_id = request.userId
    file_path = request.filePath
    view_state = request.viewState or None
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
    
    # Candidate host ports (9000-9009) for optional direct access/debugging.
    used_ports = {s['port'] for s in active_sessions.values()}
    candidate_ports = [p for p in range(9000, 9010) if p not in used_ports]
    if not candidate_ports:
        raise HTTPException(status_code=503, detail="No available ports")
    
    # Build paths - use environment variable if set, otherwise calculate
    workspace_root = os.getenv('WORKSPACE_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
        
        # Build the explicit command to run inside the session container.
        # This avoids relying on the image default CMD, which can vary across environments.
        container_cmd = [
            'python3',
            '/app/viewer.py',
            '--host', '0.0.0.0',
            '--port', '9000',
        ]

        if file_path:
            # File path should be relative to the /data mount point.
            file_name = os.path.basename(file_path)
            container_cmd.extend(['--file', f'/data/{file_name}'])
        if view_state:
            encoded_state = json.dumps(view_state, separators=(',', ':'))
            container_cmd.extend(['--view-state', encoded_state])

        container_id = ""
        port = None
        last_error = None
        for candidate_port in candidate_ports:
            # Build docker run command for this port candidate.
            docker_cmd = [
                'run',
                '-d',
                '--name', container_name,
                '--label', 'trame-service=true',
                '--label', f'user={user_id}',
                '--network', 'trame-net',
                '-p', f'{candidate_port}:9000',
                '-v', f'{user_files_path}:/data',
                '-e', f'USER_ID={user_id}',
                '-e', 'VTK_DEFAULT_OPENGL_WINDOW=vtkEGLRenderWindow',
            ]

            # Add GPU support if available (set USE_GPU=false for local testing without NVIDIA runtime)
            if USE_GPU:
                docker_cmd.extend(['--gpus', 'all'])
            docker_cmd.append(TRAME_IMAGE)
            docker_cmd.extend(container_cmd)

            logger.info(
                f"Starting container {container_name} from image {TRAME_IMAGE} on port {candidate_port}"
                + (f" with file {file_path}" if file_path else "")
            )
            try:
                result = run_docker(docker_cmd)
                container_id = result.stdout.strip()
                port = candidate_port
                break
            except Exception as err:
                message = str(err).lower()
                last_error = err
                # Retry next candidate when Docker reports bind collisions.
                if "port is already allocated" in message or "bind for 0.0.0.0" in message:
                    run_docker(['rm', '-f', container_name], check=False)
                    continue
                raise

        if not container_id or port is None:
            raise RuntimeError(f"No available host port could be bound for {container_name}: {last_error}")
        
        # Wait until the container is actually serving requests before reporting success.
        ready = await wait_for_container_ready(container_name, 9000, max_wait_seconds=60)
        if not ready:
            stop_container(container_id)
            raise RuntimeError(f"Container {container_name} did not become ready on port 9000 in time")

        # Store session info (sliding lease from touch_session_activity)
        now = time.time()
        active_sessions[session_id] = {
            "container_id": container_id,
            "container_name": container_name,
            "port": port,
            "user_id": user_id,
            "started_at": now,
            "last_activity": now,
            "lease_expires_at": now + SESSION_TTL_SECONDS,
        }
        touch_session_activity(session_id)

        logger.info(f"Started session {session_id} for user {user_id} on port {port}")
        
        return SessionResponse(
            sessionId=session_id,
            port=port,
            wsUrl=f"ws://localhost:{port}/ws",
            userId=user_id,
            containerName=container_name
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
    """Extend the session sliding lease (called periodically while the viewer is open)."""
    lease_end = touch_session_activity(session_id)
    if lease_end is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "status": "ok",
        "sessionTtlSeconds": SESSION_TTL_SECONDS,
        "leaseExpiresAt": lease_end,
        "maxSessionWallSeconds": MAX_SESSION_WALL_SECONDS or None,
    }


@app.post("/api/sessions/{session_id}/save")
async def save_session(session_id: str, request: Optional[SaveSessionRequest] = None):
    """Save the active Trame session scene into the mounted /data directory."""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]
    container_id = session["container_id"]
    request = request or SaveSessionRequest()
    requested_name = os.path.basename(request.targetFileName) if request.targetFileName else "last-saved-scene.mrb"
    if not requested_name.lower().endswith(".mrb"):
        requested_name = f"{requested_name}.mrb"
    output_path = f"/data/{requested_name}"
    request_id = f"{int(time.time() * 1000)}-{session_id}"

    try:
        # Ask the live viewer process to save by dropping a JSON request file.
        request_file = f"/tmp/trame-save-request-{request_id}.json"
        result_file = f"/tmp/trame-save-result-{request_id}.json"
        logger.info(f"Save request {request_id}: target {output_path}")
        run_docker(
            [
                "exec",
                container_id,
                "python3",
                "-c",
                (
                    "import json; "
                    f"payload={{'request_id': '{request_id}', 'output_path': '{output_path}'}}; "
                    f"open('{request_file}','w').write(json.dumps(payload))"
                ),
            ]
        )

        # Wait for explicit result from the live viewer save watcher.
        ready = False
        result_payload = None
        for _ in range(30):
            probe = run_docker(
                [
                    "exec",
                    container_id,
                    "python3",
                    "-c",
                    (
                        "import os; "
                        f"p='{result_file}'; "
                        "print(open(p).read() if os.path.exists(p) else '')"
                    ),
                ],
                check=False,
            )
            raw = (probe.stdout or "").strip()
            if raw:
                try:
                    result_payload = json.loads(raw)
                    ready = True
                    break
                except Exception:
                    pass
            await asyncio.sleep(0.5)

        if not ready:
            raise RuntimeError(f"Timed out waiting for save result {result_file}")

        # Cleanup result marker now that we've consumed it.
        run_docker(["exec", container_id, "sh", "-lc", f"rm -f {result_file}"], check=False)

        if not result_payload.get("success"):
            raise RuntimeError(result_payload.get("error") or "Viewer save watcher reported failure")
        if int(result_payload.get("size", 0)) <= 0:
            raise RuntimeError(f"Saved file is empty: {output_path}")
        logger.info(f"Save request {request_id} completed: {result_payload}")

        touch_session_activity(session_id)
        return {"status": "saved", "sessionId": session_id, "path": output_path}
    except Exception as err:
        logger.error(f"Failed to save session {session_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Failed to save session: {err}")


@app.post("/api/sessions/{session_id}/apply-view-state")
async def apply_view_state(session_id: str, request: ApplyViewStateRequest):
    """Ask the live viewer to apply a view-state payload after startup."""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]
    container_id = session["container_id"]
    request_id = f"{int(time.time() * 1000)}-{session_id}"
    request_file = f"/tmp/trame-apply-view-state-request-{request_id}.json"
    result_file = f"/tmp/trame-apply-view-state-result-{request_id}.json"
    request_payload_json = json.dumps({
        "request_id": request_id,
        "view_state": request.viewState or {}
    })
    try:
        run_docker(
            [
                "exec",
                container_id,
                "python3",
                "-c",
                (
                    f"open('{request_file}','w').write({json.dumps(request_payload_json)})"
                ),
            ]
        )

        result_payload = None
        # Keep this timeout longer than viewer-side replay retries.
        # Viewer may wait ~40s for late MRB scene initialization.
        for _ in range(130):
            probe = run_docker(
                [
                    "exec",
                    container_id,
                    "python3",
                    "-c",
                    (
                        "import os; "
                        f"p='{result_file}'; "
                        "print(open(p).read() if os.path.exists(p) else '')"
                    ),
                ],
                check=False,
            )
            raw = (probe.stdout or "").strip()
            if raw:
                try:
                    result_payload = json.loads(raw)
                    break
                except Exception:
                    pass
            await asyncio.sleep(0.5)

        run_docker(["exec", container_id, "sh", "-lc", f"rm -f {result_file}"], check=False)
        if not result_payload:
            return {
                "status": "failed",
                "sessionId": session_id,
                "error": "View-state apply produced no result payload",
                "debug": None,
            }

        touch_session_activity(session_id)
        return {
            "status": "applied" if result_payload.get("success") else "failed",
            "sessionId": session_id,
            "error": "" if result_payload.get("success") else (result_payload.get("error") or "View-state apply failed"),
            "debug": result_payload.get("debug"),
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Failed to apply view state for {session_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Failed to apply view state: {err}")


@app.get("/api/sessions/{session_id}/view-state")
async def get_view_state(session_id: str):
    """Capture a best-effort current view state from the live viewer."""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]
    container_id = session["container_id"]
    request_id = f"{int(time.time() * 1000)}-{session_id}"
    request_file = f"/tmp/trame-view-state-request-{request_id}.json"
    result_file = f"/tmp/trame-view-state-result-{request_id}.json"
    try:
        run_docker(
            [
                "exec",
                container_id,
                "python3",
                "-c",
                (
                    "import json; "
                    f"payload={{'request_id': '{request_id}'}}; "
                    f"open('{request_file}','w').write(json.dumps(payload))"
                ),
            ]
        )

        result_payload = None
        for _ in range(30):
            probe = run_docker(
                [
                    "exec",
                    container_id,
                    "python3",
                    "-c",
                    (
                        "import os; "
                        f"p='{result_file}'; "
                        "print(open(p).read() if os.path.exists(p) else '')"
                    ),
                ],
                check=False,
            )
            raw = (probe.stdout or "").strip()
            if raw:
                try:
                    result_payload = json.loads(raw)
                    break
                except Exception:
                    pass
            await asyncio.sleep(0.35)

        run_docker(["exec", container_id, "sh", "-lc", f"rm -f {result_file}"], check=False)
        if not result_payload or not result_payload.get("success"):
            return {"viewState": {"captureMode": "fallback"}}

        touch_session_activity(session_id)
        return {"viewState": result_payload.get("view_state") or {"captureMode": "fallback"}}
    except Exception as err:
        logger.error(f"Failed to capture view state for {session_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Failed to capture view state: {err}")


@app.get("/api/sessions")
async def list_sessions():
    """List all active sessions"""
    now = time.time()
    return {
        "sessions": [
            {
                "sessionId": sid,
                "userId": s["user_id"],
                "port": s["port"],
                "idleMinutes": (now - s["last_activity"]) / 60,
                "leaseExpiresAt": s.get("lease_expires_at"),
                "sessionTtlSeconds": SESSION_TTL_SECONDS,
                "minutesUntilLeaseExpiry": max(0, (s.get("lease_expires_at", now) - now) / 60),
            }
            for sid, s in active_sessions.items()
        ],
        "sessionTtlSeconds": SESSION_TTL_SECONDS,
        "maxSessionWallSeconds": MAX_SESSION_WALL_SECONDS or None,
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port)
