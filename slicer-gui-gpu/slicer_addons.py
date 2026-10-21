"""Shared slicer-addons.json helpers (catalog extensions + scripted modules)."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_ADDONS_FILE = "/usr/local/share/slicer-web/slicer-addons.json"
DEFAULT_MODULES_ROOT = Path("/opt/slicer-modules")
SYNC_STAMP_NAME = ".last-sync"
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]*$")


def modules_root() -> Path:
    raw = (os.environ.get("SLICER_MODULES_ROOT") or "").strip()
    return Path(raw) if raw else DEFAULT_MODULES_ROOT


def addons_path() -> Path:
    env = (os.environ.get("SLICER_ADDONS_FILE") or "").strip()
    if env:
        return Path(env)
    beside = Path(__file__).resolve().parent / "slicer-addons.json"
    if beside.is_file():
        return beside
    return Path(DEFAULT_ADDONS_FILE)


def load_addons(path: Path | None = None) -> dict[str, Any]:
    p = path or addons_path()
    if not p.is_file():
        return {"extensions": [], "modules": []}
    with p.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"addons manifest must be an object: {p}")
    data.setdefault("extensions", [])
    data.setdefault("modules", [])
    return data


def parse_extension_name(raw: str) -> str | None:
    name = (raw or "").strip()
    if not name or name.startswith("#"):
        return None
    if "#" in name:
        name = name.split("#", 1)[0].strip()
    if not name or not _NAME_RE.match(name):
        return None
    return name


def list_extensions(data: dict[str, Any] | None = None) -> list[str]:
    """Resolve catalog extension names (env override wins)."""
    override = os.environ.get("SLICER_EXTENSIONS", "").strip()
    if override:
        names: list[str] = []
        for part in override.replace(",", " ").split():
            name = parse_extension_name(part)
            if name and name not in names:
                names.append(name)
        return names

    data = data if data is not None else load_addons()
    names = []
    for item in data.get("extensions") or []:
        name = parse_extension_name(str(item))
        if name and name not in names:
            names.append(name)
    return names


def list_modules(data: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = data if data is not None else load_addons()
    root = modules_root()
    out: list[dict[str, Any]] = []
    for raw in data.get("modules") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or not _NAME_RE.match(name):
            continue
        subdir = str(raw.get("subdir") or name).strip() or name
        entry_py = str(raw.get("entry_py") or f"{name}.py").strip()
        repo_env = str(raw.get("repo_env") or f"SLICER_MODULE_{name}_REPO").strip()
        ref_env = str(raw.get("ref_env") or f"SLICER_MODULE_{name}_REF").strip()
        out.append({
            "name": name,
            "subdir": subdir,
            "entry_py": entry_py,
            "repo_env": repo_env,
            "ref_env": ref_env,
            "install_path": str(root / name),
        })
    return out


def module_search_paths(mod: dict[str, Any]) -> list[Path]:
    """Candidate dirs that contain entry_py (sync/image, then data fallback)."""
    name = mod["name"]
    entry = mod["entry_py"]
    env_key = f"SLICER_MODULE_{name}_PATH"
    root = modules_root()
    candidates = []
    if os.environ.get(env_key):
        candidates.append(Path(os.environ[env_key]))
    if name == "SimplifiedViewer" and os.environ.get("SLICER_SIMPLIFIED_VIEWER_PATH"):
        candidates.append(Path(os.environ["SLICER_SIMPLIFIED_VIEWER_PATH"]))
    candidates.append(root / name)
    candidates.append(Path("/home/slicer/data") / name)
    seen = set()
    out: list[Path] = []
    for p in candidates:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if (p / entry).is_file():
            out.append(p)
    return out


def discovery_path_for_module_dir(module_dir: Path) -> Path:
    """Return the module directory itself; Slicer scans only direct children of each path."""
    return module_dir


def simplified_viewer_module_dirs() -> list[Path]:
    candidates = [
        Path(os.environ.get("SLICER_SIMPLIFIED_VIEWER_PATH") or ""),
        modules_root() / "SimplifiedViewer",
        Path("/home/slicer/data/SimplifiedViewer"),
    ]
    out: list[Path] = []
    seen = set()
    for path in candidates:
        if not path or not str(path).strip():
            continue
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if (path / "SimplifiedViewer.py").is_file():
            out.append(path)
    return out


def launch_additional_module_paths() -> list[str]:
    """Paths for Slicer --additional-module-paths (manifest + SimplifiedViewer fallback)."""
    paths: list[str] = []
    seen = set()

    def add(path: Path) -> None:
        key = str(path)
        if key in seen:
            return
        seen.add(key)
        paths.append(key)

    for mod in list_modules():
        found = module_search_paths(mod)
        if not found:
            print(f"[slicer-addons] WARNING: module not found: {mod['name']}", flush=True)
            continue
        add(discovery_path_for_module_dir(found[0]))

    for module_dir in simplified_viewer_module_dirs():
        add(discovery_path_for_module_dir(module_dir))

    return paths


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"[slicer-addons] + {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None)


def install_git_module(mod: dict[str, Any], dest_root: Path | None = None) -> bool:
    """Clone module repo when repo_env is set. Returns True if installed."""
    repo = (os.environ.get(mod["repo_env"]) or "").strip()
    if not repo:
        print(
            f"[slicer-addons] skip {mod['name']}: {mod['repo_env']} not set",
            flush=True,
        )
        return False

    ref = (os.environ.get(mod["ref_env"]) or "").strip()
    root = dest_root or modules_root()
    dest = root / mod["name"]
    root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="slicer-mod-") as tmp:
        tmp_path = Path(tmp)
        clone_dir = tmp_path / "repo"
        clone_cmd = ["git", "clone", "--depth", "1"]
        if ref:
            clone_cmd.extend(["--branch", ref])
        clone_cmd.extend([repo, str(clone_dir)])
        try:
            _run(clone_cmd)
        except subprocess.CalledProcessError:
            # ref may be a SHA — fall back to fetch/checkout
            _run(["git", "clone", "--depth", "1", repo, str(clone_dir)])
            if ref:
                _run(["git", "fetch", "--depth", "1", "origin", ref], cwd=clone_dir)
                _run(["git", "checkout", ref], cwd=clone_dir)

        src = clone_dir / mod["subdir"]
        entry = src / mod["entry_py"]
        if not entry.is_file():
            raise FileNotFoundError(
                f"{mod['name']}: expected {mod['subdir']}/{mod['entry_py']} in repo"
            )

        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        print(f"[slicer-addons] installed module {mod['name']} -> {dest}", flush=True)

    return True


def install_all_modules(dest_root: Path | None = None) -> int:
    """Install every module that has a repo env set. Returns count installed."""
    root = dest_root or modules_root()
    installed = 0
    for mod in list_modules():
        if install_git_module(mod, dest_root=root):
            installed += 1
    return installed


def write_sync_stamp(host_dir: Path, extra: dict[str, Any] | None = None) -> None:
    host_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    (host_dir / SYNC_STAMP_NAME).write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )


def sync_dir_ready(host_dir: Path) -> bool:
    """True when a daily sync has populated this host tree."""
    if not host_dir.is_dir():
        return False
    if not (host_dir / SYNC_STAMP_NAME).is_file():
        return False
    modules = host_dir / "modules"
    slicer_org = host_dir / "slicer.org"
    return modules.is_dir() or slicer_org.is_dir()
