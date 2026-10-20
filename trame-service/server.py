"""
Trame Visualization Service - Manages multiple concurrent Trame sessions using Docker
Uses subprocess to call Docker CLI directly (more reliable on Windows than docker-py)
"""

from fastapi import FastAPI, HTTPException, Header, Request
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
import re
import urllib.request
from typing import Dict, Optional, List
import logging
from runtime import create_runtime
from runtime.ipc import write_json_file, read_json_file, remove_file

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
runtime = create_runtime(logger)
RUNTIME_MODE = getattr(runtime, "mode", "docker")

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
# 'd3d12' = GPU OpenGL via Mesa D3D12 on Docker Desktop/WSL2 hosts; empty = image default
CONTAINER_GL_MODE = (os.getenv('CONTAINER_GL_MODE') or '').strip().lower()
TRAME_IMAGE = (os.getenv('TRAME_IMAGE') or 'slicer-web-trame:local').strip() or 'slicer-web-trame:local'
TRAME_SYNC_TOKEN = (os.getenv('TRAME_SYNC_TOKEN') or '').strip()


def workspace_root() -> str:
    return os.getenv('WORKSPACE_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def user_files_dir(user_id: str) -> str:
    return os.path.join(workspace_root(), "backend", "userFiles", user_id)


def docker_bind_source_path(native_path: str) -> str:
    """
    Map a path visible inside trame-service to a host path for `docker run -v`.

    Inside compose, repo is mounted at WORKSPACE_ROOT (/workspace). Nested docker
    must bind the real host directory (HOST_WORKSPACE_ROOT), not /workspace/...
    """
    native = os.path.normpath(native_path)
    host_root = (os.getenv("HOST_WORKSPACE_ROOT") or "").strip()
    ws_root = os.path.normpath(workspace_root())

    if host_root:
        try:
            rel = os.path.relpath(native, ws_root)
        except ValueError:
            rel = None
        if rel and not rel.startswith(".."):
            host_path = os.path.join(host_root, rel)
        else:
            host_path = native
    else:
        host_path = native

    host_path = host_path.replace("\\", "/")
    if len(host_path) >= 2 and host_path[1] == ":":
        drive, tail = host_path.split(":", 1)
        host_path = f"/{drive.lower()}{tail}"
    return host_path


def save_output_path(session: dict, requested_name: str) -> str:
    if RUNTIME_MODE == "process":
        base = session.get("user_files_path") or user_files_dir(session["user_id"])
        return os.path.join(base, requested_name)
    return f"/data/{requested_name}"


def is_process_alive(pid: str) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except (ProcessLookupError, ValueError, PermissionError, OSError):
        return False


async def write_viewer_request_file(container_id: str, request_file: str, payload: dict) -> None:
    if RUNTIME_MODE == "process":
        write_json_file(request_file, payload)
        return
    payload_json = json.dumps(payload)
    run_docker(
        [
            "exec",
            container_id,
            "python3",
            "-c",
            (
                "import json; "
                f"open({json.dumps(request_file)}, 'w').write({json.dumps(payload_json)})"
            ),
        ]
    )


async def poll_viewer_result_file(
    container_id: str,
    result_file: str,
    poll_count: int,
    poll_interval_seconds: float,
) -> Optional[dict]:
    if RUNTIME_MODE == "process":
        for _ in range(poll_count):
            payload = read_json_file(result_file)
            if payload is not None:
                remove_file(result_file)
                return payload
            await asyncio.sleep(poll_interval_seconds)
        return None

    for _ in range(poll_count):
        probe = run_docker(
            [
                "exec",
                container_id,
                "python3",
                "-c",
                (
                    "import os; "
                    f"p={json.dumps(result_file)}; "
                    "print(open(p).read() if os.path.exists(p) else '')"
                ),
            ],
            check=False,
        )
        raw = (probe.stdout or "").strip()
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                pass
        await asyncio.sleep(poll_interval_seconds)
    return None


async def cleanup_viewer_result_file(container_id: str, result_file: str) -> None:
    if RUNTIME_MODE == "process":
        remove_file(result_file)
        return
    if not result_file.startswith("/tmp/trame-"):
        logger.warning("Refusing to delete unexpected result file path: %s", result_file)
        return
    run_docker(["exec", container_id, "rm", "-f", result_file], check=False)


def run_docker(args: List[str], check=True):
    """Compatibility wrapper while runtime adapter is introduced."""
    return runtime.run_command(args, check=check)


def trame_image_inspect() -> dict:
    """Return whether TRAME_IMAGE exists locally and basic metadata (for /health and startup)."""
    return runtime.image_inspect(TRAME_IMAGE)


def check_docker_available() -> bool:
    """Check if Docker is available"""
    return runtime.check_available()


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
    """Stop and remove a runtime session container."""
    runtime.stop_container(container_id)


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
    """Remove stale runtime session instances left behind after crashes or partial cleanups."""
    runtime.prune_stopped_sessions()


def is_host_port_open(host: str, port: int, timeout_seconds: float = 1.0) -> bool:
    """Check if a host is accepting TCP connections on the given port."""
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            return True
    except (OSError, socket.timeout):
        return False


async def wait_for_container_ready(container_name: str, port: int, max_wait_seconds: int = 60) -> bool:
    """Wait until the container starts accepting connections on the expected port."""
    deadline = time.time() + max_wait_seconds
    while time.time() < deadline:
        if is_host_port_open(container_name, port):
            return True
        await asyncio.sleep(0.25)
    return False


async def enforce_session_leases():
    """Stop sessions whose sliding lease expired (no recent heartbeat / activity)."""
    while True:
        try:
            await asyncio.sleep(60)
            now = time.time()
            for session_id, session in list(active_sessions.items()):
                if RUNTIME_MODE == "process" and not is_process_alive(session.get("container_id", "")):
                    logger.info("Session %s process is no longer running, removing session", session_id)
                    del active_sessions[session_id]
                    continue
                lease_end = session.get("lease_expires_at")
                if lease_end is None or now >= lease_end:
                    idle_min = (now - session.get("last_activity", now)) / 60.0
                    logger.info(
                        "Session %s lease expired (last activity %.1f min ago), removing session",
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
    logger.info("Trame service starting (runtime=%s)", RUNTIME_MODE)
    if RUNTIME_MODE == "docker":
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
    if not check_docker_available():
        logger.error("Session runtime is not available")

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


class HeartbeatRequest(BaseModel):
    userActive: bool = False


class ApplyViewStateRequest(BaseModel):
    viewState: dict


class PullFileRequest(BaseModel):
    userId: str
    fileName: str
    sourceUrl: str


def _verify_sync_auth(authorization: Optional[str]) -> None:
    if not TRAME_SYNC_TOKEN:
        raise HTTPException(status_code=403, detail="File sync is not configured on this host")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing sync authorization")
    token = authorization[7:].strip()
    if token != TRAME_SYNC_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid sync authorization")


def _safe_user_file(user_id: str, file_name: str) -> str:
    if not re.match(r"^[a-zA-Z0-9._-]+$", user_id):
        raise HTTPException(status_code=400, detail="Invalid userId")
    safe_name = os.path.basename(file_name)
    if not safe_name or safe_name in (".", "..") or ".." in safe_name:
        raise HTTPException(status_code=400, detail="Invalid fileName")
    return safe_name


def _safe_user_id(user_id: str) -> str:
    if not re.match(r"^[a-zA-Z0-9._-]+$", user_id):
        raise HTTPException(status_code=400, detail="Invalid userId")
    return user_id


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    runtime_ok = check_docker_available()
    img = trame_image_inspect() if RUNTIME_MODE == "docker" else {"present": True}
    return {
        "status": "healthy" if runtime_ok else "degraded",
        "runtime": RUNTIME_MODE,
        "docker": "available" if runtime_ok else "unavailable",
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
        if RUNTIME_MODE == "process":
            raise HTTPException(status_code=503, detail="Process runtime is not available")
        raise HTTPException(status_code=503, detail="Docker is not available")

    if RUNTIME_MODE != "process":
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
    
    user_id = _safe_user_id(request.userId)
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
    user_files_path_native = user_files_dir(user_id)
    os.makedirs(user_files_path_native, exist_ok=True)
    
    container_name = f"trame-session-{user_id}"
    
    try:
        container_id = ""
        port = None
        last_error = None
        if RUNTIME_MODE == "process":
            viewer_bin = (os.getenv("TRAME_VIEWER_BIN") or "python3").strip() or "python3"
            viewer_script = (os.getenv("TRAME_VIEWER_SCRIPT") or "/app/viewer.py").strip() or "/app/viewer.py"
            process_cmd_base = [viewer_bin, viewer_script, "--host", "0.0.0.0"]
            process_env = os.environ.copy()
            pythonpath = (os.getenv("PYTHONPATH") or "/app").strip() or "/app"
            process_env["PYTHONPATH"] = pythonpath

            for candidate_port in candidate_ports:
                process_cmd = process_cmd_base + ["--port", str(candidate_port)]
                if file_path:
                    file_name = os.path.basename(file_path)
                    process_cmd.extend(["--file", os.path.join(user_files_path_native, file_name)])
                if view_state:
                    encoded_state = json.dumps(view_state, separators=(",", ":"))
                    process_cmd.extend(["--view-state", encoded_state])

                logger.info(
                    "Starting process session %s on port %s%s",
                    container_name,
                    candidate_port,
                    f" with file {file_path}" if file_path else "",
                )
                try:
                    kwargs = {}
                    if os.name != "nt":
                        kwargs["start_new_session"] = True
                    proc = subprocess.Popen(
                        process_cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        env=process_env,
                        cwd="/app",
                        **kwargs,
                    )
                    if proc.poll() is not None:
                        err_out = (proc.stderr.read() or b"").decode("utf-8", errors="replace").strip()
                        raise RuntimeError(
                            f"viewer process exited immediately with code {proc.returncode}"
                            + (f": {err_out}" if err_out else "")
                        )
                    if not await wait_for_container_ready("127.0.0.1", candidate_port, max_wait_seconds=60):
                        runtime.stop_container(str(proc.pid))
                        continue
                    container_id = str(proc.pid)
                    port = candidate_port
                    break
                except Exception as err:
                    last_error = err
                    continue
        else:
            user_files_path = docker_bind_source_path(user_files_path_native)
            logger.info("Binding user files for docker session: %s -> /data", user_files_path)

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
                    # Docker Desktop on Windows (WSL2) has no NVIDIA EGL in containers; Mesa's D3D12
                    # driver renders OpenGL on the GPU through /dev/dxg and the host's WSL libraries.
                    if CONTAINER_GL_MODE == 'd3d12':
                        docker_cmd.extend([
                            '-v', '/usr/lib/wsl:/usr/lib/wsl:ro',
                            '-e', 'LD_LIBRARY_PATH=/usr/lib/wsl/lib',
                            '-e', 'GALLIUM_DRIVER=d3d12',
                            '-e', 'MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA',
                        ])
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

        # Wait until the Docker container is actually serving requests before reporting success.
        if RUNTIME_MODE != "process":
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
            "user_files_path": user_files_path_native,
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
async def heartbeat(session_id: str, request: Optional[HeartbeatRequest] = None):
    """Extend the session sliding lease only when the viewer reports user activity."""
    request = request or HeartbeatRequest()
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    session = active_sessions[session_id]
    if request.userActive:
        lease_end = touch_session_activity(session_id)
    else:
        lease_end = session.get("lease_expires_at")
    return {
        "status": "ok",
        "sessionTtlSeconds": SESSION_TTL_SECONDS,
        "leaseExpiresAt": lease_end,
        "maxSessionWallSeconds": MAX_SESSION_WALL_SECONDS or None,
        "leaseExtended": request.userActive,
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
    output_path = save_output_path(session, requested_name)
    request_id = f"{int(time.time() * 1000)}-{session_id}"

    try:
        request_file = f"/tmp/trame-save-request-{request_id}.json"
        result_file = f"/tmp/trame-save-result-{request_id}.json"
        logger.info(f"Save request {request_id}: target {output_path}")
        await write_viewer_request_file(
            container_id,
            request_file,
            {"request_id": request_id, "output_path": output_path},
        )

        result_payload = await poll_viewer_result_file(container_id, result_file, 30, 0.5)
        if not result_payload:
            raise RuntimeError(f"Timed out waiting for save result {result_file}")

        await cleanup_viewer_result_file(container_id, result_file)

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
    try:
        await write_viewer_request_file(
            container_id,
            request_file,
            {"request_id": request_id, "view_state": request.viewState or {}},
        )

        result_payload = await poll_viewer_result_file(container_id, result_file, 130, 0.5)
        await cleanup_viewer_result_file(container_id, result_file)
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
        await write_viewer_request_file(
            container_id,
            request_file,
            {"request_id": request_id},
        )

        result_payload = await poll_viewer_result_file(container_id, result_file, 30, 0.35)
        await cleanup_viewer_result_file(container_id, result_file)
        if not result_payload or not result_payload.get("success"):
            return {"viewState": {"captureMode": "fallback"}}

        touch_session_activity(session_id)
        return {"viewState": result_payload.get("view_state") or {"captureMode": "fallback"}}
    except Exception as err:
        logger.error(f"Failed to capture view state for {session_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Failed to capture view state: {err}")


@app.get("/api/files/{user_id}/{file_name}/stat")
async def file_stat(user_id: str, file_name: str, authorization: Optional[str] = Header(None)):
    """Return on-disk size for sync skip (control plane checks before re-uploading)."""
    _verify_sync_auth(authorization)
    safe_name = _safe_user_file(user_id, file_name)
    dest = os.path.join(user_files_dir(user_id), safe_name)
    if not os.path.isfile(dest):
        raise HTTPException(status_code=404, detail="File not found")
    return {"bytes": os.path.getsize(dest), "fileName": safe_name}


@app.post("/api/files/pull")
async def pull_file(request: PullFileRequest, authorization: Optional[str] = Header(None)):
    """Fetch a scene from a temporary HTTPS URL (e.g. presigned object storage) into userFiles."""
    _verify_sync_auth(authorization)
    safe_name = _safe_user_file(request.userId, request.fileName)
    if not request.sourceUrl.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid sourceUrl")

    dest_dir = user_files_dir(request.userId)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, safe_name)

    try:
        with urllib.request.urlopen(request.sourceUrl, timeout=300) as resp:
            with open(dest, "wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    except Exception as err:
        logger.error(f"File pull failed for {request.userId}/{safe_name}: {err}")
        raise HTTPException(status_code=502, detail=f"Pull failed: {err}")

    return {"status": "ok", "path": dest, "bytes": os.path.getsize(dest)}


@app.put("/api/files/{user_id}/{file_name}")
async def upload_file(
    user_id: str,
    file_name: str,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    """Stream upload from control plane (local storage backend)."""
    _verify_sync_auth(authorization)
    safe_name = _safe_user_file(user_id, file_name)
    dest_dir = user_files_dir(user_id)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, safe_name)
    total = 0
    with open(dest, "wb") as out:
        async for chunk in request.stream():
            if chunk:
                out.write(chunk)
                total += len(chunk)
    return {"status": "ok", "path": dest, "bytes": total}


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
