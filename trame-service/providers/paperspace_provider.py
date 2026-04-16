"""
Paperspace GPU provider — manages trame-slicer sessions on a remote
Paperspace GPU VM via the Paperspace Public API v1.

Architecture (OVH + Paperspace split):
  - trame-service runs on a cheap OVH VPS (CPU-only, always on)
  - trame-slicer containers run on a Paperspace VM (GPU, pay-per-use)
  - User files live on the OVH VPS; this provider SCP's them to/from the VM

Startup flow per session:
  1. Start the Paperspace VM via API (if not already running)
  2. Poll until VM state == 'ready'
  3. SSH to VM and `docker run trame-slicer` with a bind-mount to userFiles
  4. SCP the user's file from the OVH VPS → Paperspace VM userFiles dir
  5. Write a per-user nginx location conf file and reload nginx
  6. Return SessionInfo pointing at PAPERSPACE_VM_IP:port

Teardown:
  1. SSH to VM and `docker stop && docker rm` the container
  2. Remove the nginx conf and reload nginx
  3. Optionally stop the Paperspace VM if no sessions remain

Required environment variables:
    PAPERSPACE_API_KEY          Paperspace API key
                                (console → Team Settings → API Keys)
    PAPERSPACE_MACHINE_ID       Machine ID from the VM URL in the console
                                (e.g. ps123abc4d — the last part of the URL)
    PAPERSPACE_VM_IP            Public IP of the Paperspace VM
                                (assign a static IP in the console: Machine → Settings)
    PAPERSPACE_SSH_KEY_PATH     Absolute path to the SSH private key *inside
                                the trame-service container*
                                (e.g. /run/secrets/paperspace_key)
    PAPERSPACE_WORKSPACE_ROOT   Path to the SlicerWeb repo on the Paperspace VM
                                (e.g. /home/paperspace/SlicerWeb)

Optional:
    PAPERSPACE_SSH_USER         SSH username on the VM (default: paperspace)
    PAPERSPACE_TRAME_IMAGE      Docker image on the VM to run (default: trame-slicer)
    PAPERSPACE_AUTO_STOP        Stop VM when last session ends (default: true)
                                Set to false to keep VM warm for faster re-launch.
    NGINX_USERS_DIR             Directory where per-user nginx confs are written.
                                Must be shared with the nginx container as a volume.
                                (default: /app/nginx-users)
    NGINX_CONTAINER             Docker container name of nginx to reload
                                (default: nginx)
"""

import asyncio
import logging
import os
import time
from typing import Optional

import aiohttp

from .base import GpuSessionProvider, SessionInfo

logger = logging.getLogger(__name__)

PAPERSPACE_API_BASE = "https://api.paperspace.com/v1"
PAPERSPACE_API_KEY = os.getenv('PAPERSPACE_API_KEY', '')
PAPERSPACE_MACHINE_ID = os.getenv('PAPERSPACE_MACHINE_ID', '')
PAPERSPACE_VM_IP = os.getenv('PAPERSPACE_VM_IP', '')
PAPERSPACE_SSH_KEY_PATH = os.getenv('PAPERSPACE_SSH_KEY_PATH', '')
PAPERSPACE_SSH_USER = os.getenv('PAPERSPACE_SSH_USER', 'paperspace')
PAPERSPACE_TRAME_IMAGE = os.getenv('PAPERSPACE_TRAME_IMAGE', 'trame-slicer')
PAPERSPACE_WORKSPACE_ROOT = os.getenv('PAPERSPACE_WORKSPACE_ROOT', '/home/paperspace/SlicerWeb')
PAPERSPACE_AUTO_STOP = os.getenv('PAPERSPACE_AUTO_STOP', 'true').lower() in ('true', '1', 'yes')

NGINX_USERS_DIR = os.getenv('NGINX_USERS_DIR', '/app/nginx-users')
NGINX_CONTAINER = os.getenv('NGINX_CONTAINER', 'nginx')

TRAME_INTERNAL_PORT = 9000


def _paperspace_headers() -> dict:
    return {
        "Authorization": f"Bearer {PAPERSPACE_API_KEY}",
        "Content-Type": "application/json",
    }


class PaperspaceProvider(GpuSessionProvider):
    """
    Manages trame sessions on a remote Paperspace GPU VM.

    The VM is started on demand and optionally stopped when the last
    session ends, keeping costs to a strict pay-per-use minimum.
    """

    # ------------------------------------------------------------------ #
    #  start_session                                                       #
    # ------------------------------------------------------------------ #
    async def start_session(
        self,
        user_id: str,
        session_id: str,
        port_hint: int,
        user_files_host_path: str,
        file_name: Optional[str],
        original_file_name: Optional[str],
        parent_file_id: Optional[int],
    ) -> SessionInfo:

        if not PAPERSPACE_API_KEY:
            raise RuntimeError("PAPERSPACE_API_KEY is not set")
        if not PAPERSPACE_MACHINE_ID:
            raise RuntimeError("PAPERSPACE_MACHINE_ID is not set")
        if not PAPERSPACE_VM_IP:
            raise RuntimeError("PAPERSPACE_VM_IP is not set")
        if not PAPERSPACE_SSH_KEY_PATH:
            raise RuntimeError("PAPERSPACE_SSH_KEY_PATH is not set")

        # 1. Ensure the VM is running (starts it if off, waits for ready)
        logger.info(f"[Paperspace] Ensuring VM {PAPERSPACE_MACHINE_ID} is running...")
        await self._ensure_vm_running()
        logger.info("[Paperspace] VM is ready")

        # 2. Ensure the userFiles directory exists on the VM's filesystem
        vm_user_files_dir = f"{PAPERSPACE_WORKSPACE_ROOT}/backend/userFiles/{user_id}"
        await self._ssh(f"mkdir -p {vm_user_files_dir}")

        # 3. SCP the user's file to the VM (the container will read from /data/)
        if file_name:
            local_file = os.path.join(user_files_host_path, file_name)
            remote_file = f"{vm_user_files_dir}/{file_name}"
            logger.info(f"[Paperspace] Uploading {file_name} to VM...")
            await self._scp_to_vm(local_file, remote_file)

        # 4. Start the Docker container on the remote VM
        container_name = f"trame-session-{user_id}"
        # Remove any stale container from a previous session
        await self._ssh(f"docker rm -f {container_name} 2>/dev/null || true")

        env_flags = (
            f"-e VTK_DEFAULT_OPENGL_WINDOW=vtkEGLRenderWindow "
            f"-e VTK_USE_X=0 "
            f"-e USER_ID={user_id}"
        )
        if file_name:
            env_flags += f" -e FILE_PATH=/data/{file_name}"

        docker_cmd = (
            f"docker run -d "
            f"--name {container_name} "
            f"--gpus all "
            f"-p {port_hint}:{TRAME_INTERNAL_PORT} "
            f"-v {vm_user_files_dir}:/data "
            f"{env_flags} "
            f"{PAPERSPACE_TRAME_IMAGE}"
        )
        logger.info(f"[Paperspace] Starting container '{container_name}' on VM port {port_hint}")
        await self._ssh(docker_cmd)

        # 5. Write a per-user nginx location conf and reload nginx on the CPU VM
        await self._write_nginx_conf(user_id, PAPERSPACE_VM_IP, port_hint)
        await self._reload_nginx()

        logger.info(f"[Paperspace] Session {session_id} ready: {PAPERSPACE_VM_IP}:{port_hint}")
        return SessionInfo(
            session_id=session_id,
            container_id=container_name,
            container_name=container_name,
            host=PAPERSPACE_VM_IP,
            port=port_hint,
            user_id=user_id,
            original_file_name=original_file_name,
            parent_file_id=parent_file_id,
        )

    # ------------------------------------------------------------------ #
    #  stop_session                                                        #
    # ------------------------------------------------------------------ #
    async def stop_session(self, session: SessionInfo) -> None:
        container_name = session.container_id
        logger.info(f"[Paperspace] Stopping container '{container_name}'")
        try:
            await self._ssh(f"docker stop {container_name} && docker rm {container_name}")
        except Exception as e:
            logger.warning(f"[Paperspace] Error stopping container (may already be gone): {e}")

        # Remove the nginx location conf and reload
        await self._remove_nginx_conf(session.user_id)
        await self._reload_nginx()

        # Optionally power off the VM if no other sessions are still running
        if PAPERSPACE_AUTO_STOP:
            await self._maybe_stop_vm()

    # ------------------------------------------------------------------ #
    #  is_ready                                                            #
    # ------------------------------------------------------------------ #
    async def is_ready(self, session: SessionInfo, timeout: int = 120) -> bool:
        """Poll until the trame HTTP server inside the container responds."""
        url = f"http://{session.host}:{session.port}/"
        start = time.time()
        while time.time() - start < timeout:
            try:
                async with aiohttp.ClientSession() as client:
                    async with client.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        if resp.status < 500:
                            return True
            except Exception:
                pass
            await asyncio.sleep(2)
            logger.debug(f"[Paperspace] Waiting for trame at {url} ({int(time.time()-start)}s)...")
        return False

    # ------------------------------------------------------------------ #
    #  file transfer                                                       #
    # ------------------------------------------------------------------ #
    async def upload_file(
        self, session: SessionInfo, local_path: str, remote_filename: str
    ) -> None:
        """SCP a file from the OVH VPS to the Paperspace VM's userFiles directory."""
        remote_dir = f"{PAPERSPACE_WORKSPACE_ROOT}/backend/userFiles/{session.user_id}"
        await self._ssh(f"mkdir -p {remote_dir}")
        await self._scp_to_vm(local_path, f"{remote_dir}/{remote_filename}")

    async def download_file(
        self, session: SessionInfo, remote_filename: str, local_path: str
    ) -> None:
        """SCP a saved file from the Paperspace VM back to the OVH VPS."""
        remote_path = (
            f"{PAPERSPACE_WORKSPACE_ROOT}/backend/userFiles/"
            f"{session.user_id}/{remote_filename}"
        )
        await self._scp_from_vm(remote_path, local_path)

    # ------------------------------------------------------------------ #
    #  Paperspace API helpers                                              #
    # ------------------------------------------------------------------ #
    async def _get_vm_state(self) -> str:
        """Return the current machine state (e.g. 'ready', 'off', 'starting')."""
        async with aiohttp.ClientSession(headers=_paperspace_headers()) as client:
            async with client.get(
                f"{PAPERSPACE_API_BASE}/machines/{PAPERSPACE_MACHINE_ID}"
            ) as resp:
                data = await resp.json()
                return data.get("state", "unknown")

    async def _ensure_vm_running(self, timeout: int = 300) -> None:
        """Start the VM if it's off, then poll until state == 'ready'."""
        state = await self._get_vm_state()
        logger.info(f"[Paperspace] VM state: {state}")

        if state == "ready":
            return  # Already on — nothing to do

        if state in ("off", "stopped"):
            async with aiohttp.ClientSession(headers=_paperspace_headers()) as client:
                async with client.post(
                    f"{PAPERSPACE_API_BASE}/machines/{PAPERSPACE_MACHINE_ID}/start"
                ) as resp:
                    if resp.status not in (200, 202, 204):
                        body = await resp.text()
                        raise RuntimeError(
                            f"Failed to start Paperspace VM: HTTP {resp.status} — {body}"
                        )
            logger.info("[Paperspace] VM start request sent, polling for ready state...")

        elif state not in ("starting", "restarting"):
            raise RuntimeError(
                f"Paperspace VM is in unexpected state '{state}' — "
                f"check the Paperspace console before proceeding."
            )

        # Poll until the VM reports 'ready'
        start = time.time()
        while time.time() - start < timeout:
            await asyncio.sleep(10)
            state = await self._get_vm_state()
            elapsed = int(time.time() - start)
            logger.info(f"[Paperspace] VM state: {state} ({elapsed}s elapsed)")
            if state == "ready":
                # Brief additional wait for sshd to fully start
                await asyncio.sleep(5)
                return

        raise RuntimeError(
            f"Paperspace VM did not reach 'ready' within {timeout}s "
            f"(last state: {state})"
        )

    async def _maybe_stop_vm(self) -> None:
        """Stop the VM if no trame-session containers are running on it."""
        try:
            output = await self._ssh(
                "docker ps --filter 'name=trame-session-' --format '{{.Names}}'"
            )
            running = [line.strip() for line in output.splitlines() if line.strip()]
            if not running:
                logger.info("[Paperspace] No active sessions — powering off VM")
                async with aiohttp.ClientSession(headers=_paperspace_headers()) as client:
                    await client.post(
                        f"{PAPERSPACE_API_BASE}/machines/{PAPERSPACE_MACHINE_ID}/stop"
                    )
            else:
                logger.info(
                    f"[Paperspace] {len(running)} session(s) still running — VM stays on"
                )
        except Exception as e:
            logger.warning(f"[Paperspace] Error in _maybe_stop_vm: {e}")

    # ------------------------------------------------------------------ #
    #  SSH / SCP helpers                                                   #
    # ------------------------------------------------------------------ #
    def _ssh_base_cmd(self) -> list:
        return [
            "ssh",
            "-i", PAPERSPACE_SSH_KEY_PATH,
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=15",
            f"{PAPERSPACE_SSH_USER}@{PAPERSPACE_VM_IP}",
        ]

    async def _ssh(self, command: str) -> str:
        """Run a shell command on the Paperspace VM via SSH. Returns stdout."""
        cmd = self._ssh_base_cmd() + [command]
        logger.debug(f"[Paperspace] SSH: {command[:100]}...")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode not in (0, None):
            raise RuntimeError(
                f"SSH command failed (exit {proc.returncode}):\n"
                f"  cmd: {command[:200]}\n"
                f"  stderr: {stderr.decode()[:500]}"
            )
        return stdout.decode()

    async def _scp_to_vm(self, local_path: str, remote_path: str) -> None:
        """Copy a file from the OVH VPS to the Paperspace VM."""
        cmd = [
            "scp",
            "-i", PAPERSPACE_SSH_KEY_PATH,
            "-o", "StrictHostKeyChecking=no",
            local_path,
            f"{PAPERSPACE_SSH_USER}@{PAPERSPACE_VM_IP}:{remote_path}",
        ]
        logger.info(f"[Paperspace] SCP upload: {local_path} → VM:{remote_path}")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"SCP upload to VM failed: {stderr.decode()}")

    async def _scp_from_vm(self, remote_path: str, local_path: str) -> None:
        """Copy a file from the Paperspace VM back to the OVH VPS."""
        cmd = [
            "scp",
            "-i", PAPERSPACE_SSH_KEY_PATH,
            "-o", "StrictHostKeyChecking=no",
            f"{PAPERSPACE_SSH_USER}@{PAPERSPACE_VM_IP}:{remote_path}",
            local_path,
        ]
        logger.info(f"[Paperspace] SCP download: VM:{remote_path} → {local_path}")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"SCP download from VM failed: {stderr.decode()}")

    # ------------------------------------------------------------------ #
    #  Nginx dynamic routing                                               #
    # ------------------------------------------------------------------ #
    async def _write_nginx_conf(self, user_id: str, host: str, port: int) -> None:
        """
        Write a per-user nginx location block that proxies
        /trame-session/user-{id}/ → http://{host}:{port}/
        The file lands in NGINX_USERS_DIR which is shared with the nginx container.
        """
        os.makedirs(NGINX_USERS_DIR, exist_ok=True)
        conf_path = os.path.join(NGINX_USERS_DIR, f"trame-session-{user_id}.conf")
        conf_content = f"""# Auto-generated by PaperspaceProvider — do not edit by hand
location ~ ^/trame-session/user-{user_id}(/.*)?$ {{
    set $path $1;
    proxy_pass http://{host}:{port}$path$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}}
"""
        with open(conf_path, 'w') as f:
            f.write(conf_content)
        logger.info(f"[Paperspace] Wrote nginx conf for user {user_id}: {host}:{port}")

    async def _remove_nginx_conf(self, user_id: str) -> None:
        """Remove the per-user nginx location block."""
        conf_path = os.path.join(NGINX_USERS_DIR, f"trame-session-{user_id}.conf")
        try:
            os.remove(conf_path)
            logger.info(f"[Paperspace] Removed nginx conf for user {user_id}")
        except FileNotFoundError:
            pass  # Already gone — no problem

    async def _reload_nginx(self) -> None:
        """
        Send SIGHUP to nginx via `docker exec` to reload the conf files.
        This requires the Docker socket to be mounted in the trame-service container.
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "exec", NGINX_CONTAINER, "nginx", "-s", "reload",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(f"[Paperspace] nginx reload failed: {stderr.decode()}")
            else:
                logger.info("[Paperspace] nginx reloaded successfully")
        except Exception as e:
            logger.warning(f"[Paperspace] Could not reload nginx (non-fatal): {e}")
