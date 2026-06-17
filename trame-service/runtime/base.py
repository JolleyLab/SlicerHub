from abc import ABC, abstractmethod
from typing import List
import subprocess


class SessionRuntime(ABC):
    """Runtime interface for session lifecycle operations."""

    @abstractmethod
    def check_available(self) -> bool:
        pass

    @abstractmethod
    def image_inspect(self, image: str) -> dict:
        pass

    @abstractmethod
    def run_command(self, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        pass

    @abstractmethod
    def stop_container(self, container_id: str) -> None:
        pass

    @abstractmethod
    def prune_stopped_sessions(self) -> None:
        pass
