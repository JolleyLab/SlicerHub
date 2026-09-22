#!/usr/bin/env python3
"""Install scripted modules from slicer-addons.json (git clone → /opt/slicer-modules).

Build-time only (no Slicer process). Catalog extensions use install-slicer-extensions.py.

Usage:
  python3 /usr/local/bin/install-slicer-modules.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slicer_addons import install_all_modules, list_modules


def main() -> int:
    mods = list_modules()
    if not mods:
        print("[install-slicer-modules] no modules in manifest", flush=True)
        return 0
    print(
        "[install-slicer-modules] modules: "
        + ", ".join(m["name"] for m in mods),
        flush=True,
    )
    n = install_all_modules()
    print(f"[install-slicer-modules] installed {n}/{len(mods)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
