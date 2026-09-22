#!/usr/bin/env python3
"""
Daily (or on-demand) host sync for Slicer addons.

Writes into SLICER_ADDONS_HOST_DIR (default: <repo>/data/slicer-addons):

  modules/<name>/     scripted modules (git)
  slicer.org/         Extension Index packages (via one-shot container)
  .last-sync          stamp seats use to know sync is ready

Does NOT push a new Docker image. The adapter image stays fixed; seats mount
this directory. Works with a local base today and a Hub base later
(SLICER_GUI_IMAGE still used only as the sync tool + seat runtime).

Usage (from slicer-web or slicer-gui-gpu):
  python sync-slicer-addons.py
  ./sync-slicer-addons.ps1
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_WEB = HERE.parent  # slicer-web


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, _, val = raw.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def host_addons_dir() -> Path:
    raw = (os.environ.get("SLICER_ADDONS_HOST_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (REPO_WEB / "data" / "slicer-addons").resolve()


def docker_bind(path: Path) -> str:
    """Windows Docker Desktop style bind path."""
    s = str(path.resolve()).replace("\\", "/")
    if len(s) >= 2 and s[1] == ":":
        return f"/{s[0].lower()}{s[2:]}"
    return s


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Slicer addons onto the GPU host")
    parser.add_argument(
        "--skip-extensions",
        action="store_true",
        help="Only sync scripted modules (no Extension Manager container)",
    )
    parser.add_argument(
        "--skip-modules",
        action="store_true",
        help="Only sync catalog extensions",
    )
    args = parser.parse_args()

    _load_dotenv(REPO_WEB / ".env")
    sys.path.insert(0, str(HERE))
    from slicer_addons import (  # noqa: E402
        addons_path,
        install_all_modules,
        list_extensions,
        list_modules,
        write_sync_stamp,
    )

    host_dir = host_addons_dir()
    modules_dir = host_dir / "modules"
    slicer_org = host_dir / "slicer.org"
    modules_dir.mkdir(parents=True, exist_ok=True)
    slicer_org.mkdir(parents=True, exist_ok=True)

    manifest_src = addons_path()
    if manifest_src.is_file():
        shutil.copy2(manifest_src, host_dir / "slicer-addons.json")
        os.environ["SLICER_ADDONS_FILE"] = str(manifest_src)

    print(f"[sync-slicer-addons] host dir: {host_dir}", flush=True)

    modules_ok = 0
    if not args.skip_modules:
        os.environ["SLICER_MODULES_ROOT"] = str(modules_dir)
        mods = list_modules()
        print(
            f"[sync-slicer-addons] modules: {', '.join(m['name'] for m in mods) or '(none)'}",
            flush=True,
        )
        modules_ok = install_all_modules(dest_root=modules_dir)
        print(f"[sync-slicer-addons] modules installed/updated: {modules_ok}", flush=True)

    extensions_ok = False
    if not args.skip_extensions:
        names = list_extensions()
        image = (os.environ.get("SLICER_GUI_IMAGE") or "slicer-web-slicer-gui:local").strip()
        print(
            f"[sync-slicer-addons] extensions via {image}: {', '.join(names) or '(none)'}",
            flush=True,
        )
        if names:
            # One-shot container: install/update into mounted slicer.org (no new image).
            cmd = [
                "docker", "run", "--rm",
                "--entrypoint", "",
                "-e", "HOME=/home/slicer",
                "-e", "SLICER_EXTENSIONS_UPDATE=1",
                "-e", f"SLICER_EXTENSIONS={' '.join(names)}",
                "-v", f"{docker_bind(slicer_org)}:/home/slicer/slicer.org",
                "-v", f"{docker_bind(slicer_org)}:/home/slicer/.config/slicer.org",
                image,
                "xvfb-run", "-a",
                "/opt/Slicer/Slicer",
                "--no-splash",
                "--no-main-window",
                "--exit-after-startup",
                "--python-script", "/usr/local/bin/install-slicer-extensions.py",
                "--update",
                *names,
            ]
            print(f"[sync-slicer-addons] + {' '.join(cmd)}", flush=True)
            try:
                subprocess.check_call(cmd)
                extensions_ok = True
            except subprocess.CalledProcessError as err:
                print(
                    f"[sync-slicer-addons] WARNING: extension sync failed ({err.returncode}); "
                    "modules may still be updated",
                    flush=True,
                )
        else:
            extensions_ok = True

    write_sync_stamp(
        host_dir,
        {
            "modulesInstalled": modules_ok,
            "extensionsOk": extensions_ok,
            "image": (os.environ.get("SLICER_GUI_IMAGE") or "slicer-web-slicer-gui:local"),
            "extensions": list_extensions(),
            "modules": [m["name"] for m in list_modules()],
        },
    )
    print(f"[sync-slicer-addons] wrote {host_dir / '.last-sync'}", flush=True)
    print(json.dumps({"ok": True, "hostDir": str(host_dir)}, indent=2))
    # Stamp is enough for seats; extension warnings are non-fatal if modules synced.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
