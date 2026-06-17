from typing import List
import subprocess
import shutil
import os
import signal

from .base import SessionRuntime


class ProcessRuntime(SessionRuntime):
    """
    Placeholder for a non-Docker runtime.

    Step 2 scaffolding keeps this explicit to avoid changing API surfaces later.
    """

    def __init__(self, logger):
        self.logger = logger
        self.mode = "process"

    def check_available(self) -> bool:
        viewer_bin = (os.getenv("TRAME_VIEWER_BIN") or "python3").strip() or "python3"
        viewer_script = (os.getenv("TRAME_VIEWER_SCRIPT") or "/app/viewer.py").strip() or "/app/viewer.py"
        if shutil.which(viewer_bin) is None:
            self.logger.error("Process runtime unavailable: %s not found in PATH", viewer_bin)
            return False
        if not os.path.exists(viewer_script):
            self.logger.error("Process runtime unavailable: viewer script not found at %s", viewer_script)
            return False
        return True

    def image_inspect(self, image: str) -> dict:
        return {
            "present": True,
            "id": "process-runtime",
            "created": None,
            "repo_tags": [],
            "inspect_error": None,
        }

    def run_command(self, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        raise NotImplementedError("ProcessRuntime.run_command is not implemented yet")

    def stop_container(self, container_id: str) -> None:
        try:
            pid = int(str(container_id))
        except Exception:
            self.logger.warning("Invalid process id for stop: %s", container_id)
            return

        try:
            if os.name != "nt":
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception as e:
            self.logger.warning("Failed graceful stop for pid %s: %s", pid, e)

        try:
            if os.name != "nt":
                os.killpg(pid, signal.SIGKILL)
            else:
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            return

    def prune_stopped_sessions(self) -> None:
        # No-op for process runtime in PR1; session pruning happens in lease loop + route logic.
        return
