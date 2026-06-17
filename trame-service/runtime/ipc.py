"""Filesystem IPC helpers shared by docker exec and process runtimes."""

import json
import os
from typing import Any, Dict, Optional


def write_json_file(path: str, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload))


def read_json_file(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.loads(handle.read())
    except Exception:
        return None


def remove_file(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
