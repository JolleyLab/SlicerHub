"""Install required Slicer catalog extensions (Extension Manager).

Usage:
  Slicer --no-splash --no-main-window --exit-after-startup \\
    --python-script /usr/local/bin/install-slicer-extensions.py [--update] [ExtensionName ...]

With no names on the command line, reads slicer-addons.json (extensions list)
or SLICER_EXTENSIONS env override.

--update / SLICER_EXTENSIONS_UPDATE=1 refreshes already-installed packages
(used by daily host sync).

Scripted modules are installed separately via install-slicer-modules.py / sync.
"""
from __future__ import annotations

import os
import sys

import slicer

try:
    from slicer_addons import list_extensions, parse_extension_name
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from slicer_addons import list_extensions, parse_extension_name


def extension_dir_for(name: str) -> str | None:
    roots = [
        os.path.expanduser("~/slicer.org"),
        os.path.join(os.path.expanduser("~"), ".config", "slicer.org"),
        "/home/slicer/slicer.org",
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, _filenames in os.walk(root):
            for dirname in dirnames:
                if name.lower() in dirname.lower():
                    return os.path.join(dirpath, dirname)
            if dirpath.count(os.sep) - root.count(os.sep) > 4:
                dirnames[:] = []
    return None


def is_really_installed(em, name: str) -> bool:
    try:
        if em.isExtensionInstalled(name):
            found = extension_dir_for(name)
            if found:
                print(f"[install-slicer-extensions] found on disk: {found}", flush=True)
                return True
            print(
                f"[install-slicer-extensions] manager says installed, but files not found yet: {name}",
                flush=True,
            )
            return True
    except Exception as exc:
        print(f"[install-slicer-extensions] isExtensionInstalled failed: {exc}", flush=True)
    return False


def install_extension(name: str, update: bool = False) -> None:
    em = slicer.app.extensionsManagerModel()
    em.interactive = False

    already = is_really_installed(em, name)
    if already and not update:
        print(f"[install-slicer-extensions] already installed: {name}", flush=True)
        return

    print(
        f"[install-slicer-extensions] {'updating' if already else 'installing'}: {name}",
        flush=True,
    )
    try:
        em.updateExtensionsMetadataFromServer(True, True)
    except Exception as exc:
        print(f"[install-slicer-extensions] metadata update warning: {exc}", flush=True)

    if already and update:
        updated = False
        for method_name in ("updateExtension", "scheduleExtensionForUpdate"):
            method = getattr(em, method_name, None)
            if callable(method):
                try:
                    method(name)
                    updated = True
                    print(f"[install-slicer-extensions] {method_name}({name})", flush=True)
                    break
                except Exception as exc:
                    print(f"[install-slicer-extensions] {method_name} failed: {exc}", flush=True)
        if updated:
            return

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


def parse_flags(argv: list[str]) -> tuple[bool, list[str]]:
    update = os.environ.get("SLICER_EXTENSIONS_UPDATE", "").strip().lower() in {
        "1", "true", "yes"
    }
    names: list[str] = []
    for arg in argv[1:]:
        if arg in ("--update", "-u"):
            update = True
            continue
        name = parse_extension_name(arg)
        if name and name not in names:
            names.append(name)
    return update, names


def requested_extensions(names_from_argv: list[str]) -> list[str]:
    if names_from_argv:
        return names_from_argv
    return list_extensions()


def main(argv: list[str]) -> int:
    update, from_argv = parse_flags(argv)
    names = requested_extensions(from_argv)
    if not names:
        print("[install-slicer-extensions] no extensions listed", flush=True)
        return 0
    print(
        f"[install-slicer-extensions] requested: {', '.join(names)}"
        f"{' (update)' if update else ''}",
        flush=True,
    )
    for name in names:
        install_extension(name, update=update)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
