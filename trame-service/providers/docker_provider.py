"""
Docker provider — current Paperspace / VM-based implementation.

Behaviour is identical to the original server.py Docker logic, extracted
into the GpuSessionProvider interface so server.py becomes provider-agnostic.
"""

import os
import subprocess
import json
import time
import asyncio
import aiohttp
import logging
from typing import List, Optional

from .base import GpuSessionProvider, SessionInfo

logger = logging.getLogger(__name__)

USE_GPU = os.getenv('USE_GPU', 'true').lower() not in ('false', '0', 'no')


def _run_docker(args: List[str], check=True) -> subprocess.CompletedProcess:
    try:
        cmd = ['docker'] + args
        logger.debug(f"Running: {' '.join(cmd)}")
        return subprocess.run(cmd, capture_output=True, text=True, check=check)
    except subprocess.CalledProcessError as e:
        logger.error(f"Docker command failed: {e.stderr}")
        raise
    except FileNotFoundError:
        raise RuntimeError("Docker CLI not found.")


class DockerProvider(GpuSessionProvider):
    """
    Manages trame sessions as Docker containers on the local Docker daemon.
    Sessions are reachable via Docker's internal DNS (container name on trame-net).
    Files are shared via a bind-mounted volume — no transfer needed.
    Routing: nginx resolves /trame-session/user-{id}/ -> trame-session-{id}:9000
    """

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
        container_name = f"trame-session-{user_id}"

        # Convert Windows path to Docker-compatible path if needed
        docker_path = user_files_host_path.replace('\\', '/')
        if ':' in docker_path:
            drive, path = docker_path.split(':', 1)
            docker_path = f"/{drive.lower()}{path}"

        # Remove any stale container with the same name
        _run_docker(['rm', '-f', container_name], check=False)

        docker_cmd = [
            'run', '-d',
            '--name', container_name,
            '--label', 'trame-service=true',
            '--label', f'user={user_id}',
            '--network', 'trame-net',
            '-p', f'{port_hint}:9000',
            '-v', f'{docker_path}:/data',
            '-e', f'USER_ID={user_id}',
            '-e', 'VTK_DEFAULT_OPENGL_WINDOW=vtkEGLRenderWindow',
        ]

        if USE_GPU:
            docker_cmd.extend(['--gpus', 'all'])

        if file_name:
            docker_cmd.extend(['-e', f'FILE_PATH=/data/{file_name}'])

        docker_cmd.append('trame-slicer')

        logger.info(f"[Docker] Starting {container_name} on port {port_hint}")
        result = _run_docker(docker_cmd)
        container_id = result.stdout.strip()

        return SessionInfo(
            session_id=session_id,
            container_id=container_id,
            container_name=container_name,
            host=container_name,   # Docker internal DNS
            port=9000,
            user_id=user_id,
            original_file_name=original_file_name,
            parent_file_id=parent_file_id,
        )

    async def stop_session(self, session: SessionInfo) -> None:
        logger.info(f"[Docker] Stopping {session.container_id}")
        _run_docker(['stop', session.container_id], check=False)
        _run_docker(['rm', session.container_id], check=False)

    async def is_ready(self, session: SessionInfo, timeout: int = 120) -> bool:
        url = f"http://{session.host}:{session.port}/"
        start = time.time()
        while time.time() - start < timeout:
            try:
                async with aiohttp.ClientSession() as client:
                    async with client.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        if resp.status < 500:
                            logger.info(f"[Docker] {session.container_name} ready (HTTP {resp.status})")
                            return True
            except Exception:
                pass
            await asyncio.sleep(2)
            logger.info(f"[Docker] Waiting for {session.container_name}... ({int(time.time()-start)}s)")
        logger.error(f"[Docker] {session.container_name} did not become ready within {timeout}s")
        return False

    async def upload_file(self, session: SessionInfo, local_path: str, remote_filename: str) -> None:
        # Files are shared via bind mount — nothing to do
        logger.debug(f"[Docker] upload_file is a no-op (shared volume)")

    async def download_file(self, session: SessionInfo, remote_filename: str, local_path: str) -> None:
        # Files are shared via bind mount — nothing to do
        logger.debug(f"[Docker] download_file is a no-op (shared volume)")
