import os

from .docker_runtime import DockerRuntime
from .process_runtime import ProcessRuntime


def create_runtime(logger):
    mode = (os.getenv("TRAME_SESSION_RUNTIME") or "docker").strip().lower()
    if mode == "docker":
        logger.info("Session runtime: docker")
        runtime = DockerRuntime(logger)
        runtime.mode = "docker"
        return runtime
    if mode == "process":
        logger.info("Session runtime: process")
        return ProcessRuntime(logger)
    raise ValueError(f"Unsupported TRAME_SESSION_RUNTIME: {mode}")
