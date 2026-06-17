import json
import subprocess
from typing import List

from .base import SessionRuntime


class DockerRuntime(SessionRuntime):
    """Session runtime backed by Docker CLI commands."""

    def __init__(self, logger):
        self.logger = logger

    def run_command(self, args: List[str], check: bool = True) -> subprocess.CompletedProcess:
        try:
            cmd = ["docker"] + args
            self.logger.debug("Running: %s", " ".join(cmd))
            result = subprocess.run(cmd, capture_output=True, text=True, check=check)
            return result
        except subprocess.CalledProcessError as e:
            self.logger.error("Docker command failed: %s", e.stderr)
            raise
        except FileNotFoundError:
            raise RuntimeError("Docker CLI not found. Ensure Docker is installed.")

    def check_available(self) -> bool:
        try:
            result = self.run_command(["version", "--format", "{{.Server.Version}}"], check=False)
            if result.returncode == 0:
                self.logger.info("Docker available, version: %s", result.stdout.strip())
                return True
            self.logger.error("Docker check failed: %s", result.stderr)
            return False
        except Exception as e:
            self.logger.error("Docker check failed: %s", e)
            return False

    def image_inspect(self, image: str) -> dict:
        result = self.run_command(
            [
                "image",
                "inspect",
                image,
                "--format",
                "{{.Id}}\t{{.Created}}\t{{json .RepoTags}}",
            ],
            check=False,
        )
        if result.returncode != 0:
            return {
                "present": False,
                "id": None,
                "created": None,
                "repo_tags": [],
                "inspect_error": (result.stderr or result.stdout or "").strip(),
            }

        parts = (result.stdout or "").strip().split("\t", 2)
        img_id = parts[0] if parts else None
        created = parts[1] if len(parts) > 1 else None
        tags_raw = parts[2] if len(parts) > 2 else "[]"
        try:
            repo_tags = json.loads(tags_raw) if tags_raw else []
        except json.JSONDecodeError:
            repo_tags = [tags_raw] if tags_raw else []
        return {
            "present": True,
            "id": img_id,
            "created": created,
            "repo_tags": repo_tags,
            "inspect_error": None,
        }

    def stop_container(self, container_id: str) -> None:
        try:
            self.logger.info("Removing container %s", container_id)
            result = self.run_command(["rm", "-f", container_id], check=False)
            if result.returncode != 0:
                self.logger.warning(
                    "docker rm -f %s exited %s stderr=%s stdout=%s",
                    container_id,
                    result.returncode,
                    (result.stderr or "").strip(),
                    (result.stdout or "").strip(),
                )
        except Exception as e:
            self.logger.error("Error removing container %s: %s", container_id, e)

    def prune_stopped_sessions(self) -> None:
        try:
            result = self.run_command(
                ["container", "prune", "-f", "--filter", "label=trame-service=true"],
                check=False,
            )
            out = (result.stdout or "").strip().replace("\n", " ")
            if out:
                self.logger.info("Trame container prune: %s", out)
        except Exception as e:
            self.logger.error("Trame container prune failed: %s", e)
