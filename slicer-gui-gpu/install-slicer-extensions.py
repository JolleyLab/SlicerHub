"""Install required Slicer extensions for Simplified Viewer.

Usage:
  Slicer --no-splash --no-main-window --exit-after-startup \\
    --python-script /usr/local/bin/install-slicer-extensions.py [ExtensionName ...]
"""
from __future__ import annotations

import os
import sys

import slicer


KNOWN_EXTENSIONS = {"Sandbox", "SlicerHeart", "SlicerIGT"}


def extension_dir_for(name: str) -> str | None:
    """Best-effort locate an installed extension directory."""
    roots = [
        os.path.expanduser("~/slicer.org"),
        os.path.join(os.path.expanduser("~"), ".config", "slicer.org"),
        "/home/slicer/slicer.org",
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, _filenames in os.walk(root):
            # Keep walk shallow-ish by skipping huge trees later if needed.
            for dirname in dirnames:
                if name.lower() in dirname.lower():
                    return os.path.join(dirpath, dirname)
            # Prefer not descending forever
            if dirpath.count(os.sep) - root.count(os.sep) > 4:
                dirnames[:] = []
    return None


def is_really_installed(em, name: str) -> bool:
    try:
        if em.isExtensionInstalled(name):
            # Still verify files when possible; some builds report installed early.
            found = extension_dir_for(name)
            if found:
                print(f"[install-slicer-extensions] found on disk: {found}", flush=True)
                return True
            print(
                f"[install-slicer-extensions] manager says installed, but files not found yet: {name}",
                flush=True,
            )
            # Treat manager truth as enough if filesystem search is inconclusive.
            return True
    except Exception as exc:
        print(f"[install-slicer-extensions] isExtensionInstalled failed: {exc}", flush=True)
    return False


def install_extension(name: str) -> None:
    em = slicer.app.extensionsManagerModel()
    em.interactive = False

    if is_really_installed(em, name):
        print(f"[install-slicer-extensions] already installed: {name}", flush=True)
        return

    print(f"[install-slicer-extensions] installing: {name}", flush=True)
    try:
        em.updateExtensionsMetadataFromServer(True, True)
    except Exception as exc:
        print(f"[install-slicer-extensions] metadata update warning: {exc}", flush=True)

    ok = False
    if hasattr(em, "installExtensionFromServer"):
        ok = bool(em.installExtensionFromServer(name, False))
    elif hasattr(em, "downloadAndInstallExtensionByName"):
        ok = bool(em.downloadAndInstallExtensionByName(name, True, True))
    else:
        raise RuntimeError("No supported extension install API on this Slicer build")

    if not ok:
        raise RuntimeError(f"Failed to install extension: {name}")

    if not is_really_installed(em, name) and extension_dir_for(name) is None:
        raise RuntimeError(
            f"Install reported success for {name}, but extension files were not found"
        )

    print(f"[install-slicer-extensions] installed: {name}", flush=True)


def requested_extensions(argv: list[str]) -> list[str]:
    # Slicer may pass its own argv; only keep known extension names.
    names = [arg for arg in argv[1:] if arg in KNOWN_EXTENSIONS]
    return names or ["Sandbox"]


def main(argv: list[str]) -> int:
    names = requested_extensions(argv)
    print(f"[install-slicer-extensions] requested: {', '.join(names)}", flush=True)
    for name in names:
        install_extension(name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
