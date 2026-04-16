"""
Base interface for GPU session providers.

All providers must implement this interface. The rest of server.py only
calls these methods, so swapping providers requires only an env var change:
    GPU_PROVIDER=docker   (default, Paperspace / any VM with Docker)
    GPU_PROVIDER=vastai   (vast.ai marketplace)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class SessionInfo:
    """
    Everything server.py needs to know about a running session.

    host / port describe where the trame HTTP/WS server is reachable
    *from the CPU VM's network*.  For Docker this is the container name
    on trame-net; for vast.ai it is the public IP and mapped port.
    """
    session_id: str
    container_id: str       # provider-specific handle (Docker ID or vast.ai instance ID)
    container_name: str     # human-readable label
    host: str               # hostname or IP to reach trame server
    port: int               # port to reach trame server
    user_id: str
    original_file_name: Optional[str] = None
    parent_file_id: Optional[int] = None


class GpuSessionProvider(ABC):
    """Abstract base class for GPU session providers."""

    @abstractmethod
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
        """
        Start a new GPU session for the given user.

        Args:
            user_id:              application user ID
            session_id:           unique session identifier
            port_hint:            preferred port (providers may ignore this)
            user_files_host_path: absolute path to the user's files on the
                                  *CPU VM's* filesystem
            file_name:            filename to open inside the session (or None)
            original_file_name:   original filename for save-overwrite logic
            parent_file_id:       DB file ID for parent linking

        Returns:
            SessionInfo describing the running session.
        """

    @abstractmethod
    async def stop_session(self, session: SessionInfo) -> None:
        """Stop and clean up a session."""

    @abstractmethod
    async def is_ready(self, session: SessionInfo, timeout: int = 120) -> bool:
        """
        Poll until the trame HTTP server in the session responds.
        Returns True if ready before timeout, False otherwise.
        """

    @abstractmethod
    async def upload_file(self, session: SessionInfo, local_path: str, remote_filename: str) -> None:
        """
        Copy a file from the CPU VM into the session's /data directory.
        For Docker this is a no-op (shared volume). For vast.ai this is SCP/SFTP.
        """

    @abstractmethod
    async def download_file(self, session: SessionInfo, remote_filename: str, local_path: str) -> None:
        """
        Copy a file from the session's /data directory back to the CPU VM.
        For Docker this is a no-op (shared volume). For vast.ai this is SCP/SFTP.
        """
