# Standalone 3D Slicer GUI (GPU + noVNC)

Full desktop 3D Slicer in Docker with NVIDIA GPU acceleration and browser access via noVNC.

Based on [lassoan/SlicerCloudContainers/slicer-gui-gpu](https://github.com/lassoan/SlicerCloudContainers/tree/main/slicer-gui-gpu).

## Image layers (base + adapter)

We split the image so we can stop owning the heavy desktop stack when upstream publishes to Hub/GHCR.

| Image | Dockerfile | Owns |
|---|---|---|
| `slicer-web-slicer-gui-base:local` | `Dockerfile.base` | CUDA, Slicer, noVNC, VirtualGL, **TurboVNC**, `start.sh` — **replace with Hub tag later** |
| `slicer-web-slicer-gui:local` | `Dockerfile` | Open-request poller, `launch-slicer.sh`, addons from `slicer-addons.json` |

Backend runtime uses **`SLICER_GUI_IMAGE`** (the adapter). Set **`SLICER_GUI_BASE_IMAGE`** when deriving from a published base.

```bash
# Build both (from this directory or via helper)
./build.sh          # Linux/macOS
./build.ps1         # Windows PowerShell

# Or via compose (builds base then adapter)
docker compose --profile slicer-gui build slicer-gui-base slicer-gui
```

**Future switch (no app code change):**

```bash
# .env
SLICER_GUI_BASE_IMAGE=ghcr.io/example/slicer-gui-gpu:5.10
SLICER_GUI_BUILD_BASE=false   # skip local Dockerfile.base
SLICER_GUI_IMAGE=slicer-web-slicer-gui:local

./build.ps1   # only builds the thin adapter FROM the Hub base
```

Soft ask for upstream (optional): publish a versioned image and ideally honor `SLICER_STARTUP_SCRIPT` / keep calling `/usr/local/bin/launch-slicer.sh` so we can keep overlaying one file.

## Compose profile

This service is **optional** and does not start with the default stack:

```bash
docker compose --profile slicer-gui build slicer-gui-base slicer-gui
docker compose --profile slicer-gui up -d slicer-gui
```

VNC authentication is **off by default** (`VNC_ALLOW_NO_PASSWORD=true`). Set `VNC_ALLOW_NO_PASSWORD=false` and `VNC_PASSWORD=...` in `.env` if you need a password.

## Access

| Route | URL |
|---|---|
| Via nginx (same origin as app) | `http://localhost:8000/slicer-gui/` |
| Direct (localhost debug) | `http://127.0.0.1:6080/` |
| VNC client | Not exposed on the host; use the browser URL above |

Per-user My Projects sessions (local): the backend starts `slicer-gui-{userId}` and mounts
`data/slicer-gui/users/{userId}/` at `/home/slicer/data`. Staging writes `.open-request.json`
there; `slicer_session.py` polls and loads the file (no process restart).

Optional shared debug container (`compose --profile slicer-gui up slicer-gui`) still uses
`data/slicer-gui/` directly.

## Addons (`slicer-addons.json` + daily host sync)

**Full setup (local, Hub base, Azure N-series, cron/webhook):**  
→ **[docs/slicer-gui-addons.md](../docs/slicer-gui-addons.md)**

Summary:

| Kind | Source of truth | Example |
|---|---|---|
| **extensions** | Extension Index → host `data/slicer-addons/slicer.org` | `Sandbox`, `SlicerHeart` |
| **modules** | Git → host `data/slicer-addons/modules/<name>` | `SimplifiedViewer` |

1. Build/pull the adapter image **rarely**.  
2. Run **daily** host sync (no image push):

```powershell
cd slicer-gui-gpu
.\sync-slicer-addons.ps1
```

3. New seats mount that tree after `.last-sync` exists.

Manifest: `slicer-addons.json`. Add catalog names under `extensions`; add scripted modules under `modules` (with `repo_env` / `ref_env`). `SimplifiedViewer` uses `SLICER_HEART_VIEWER_REPO` / `REF`.

Local override: `SLICER_HEART_VIEWER_LOCAL_PATH`. Dev script mounts: `SLICER_GUI_MOUNT_DEV_SCRIPTS` (off in production).

## Requirements

- NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- ~15 GB disk for the **base** image build
- NVIDIA Container Toolkit (see below)

## Verify GPU inside the container

```bash
docker exec slicer-gui nvidia-smi
docker compose --profile slicer-gui logs slicer-gui | grep -A5 "GPU Diagnostics"
```
