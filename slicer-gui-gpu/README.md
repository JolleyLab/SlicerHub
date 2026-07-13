# Standalone 3D Slicer GUI (GPU + noVNC)

Full desktop 3D Slicer in Docker with NVIDIA GPU acceleration and browser access via noVNC.

Based on [lassoan/SlicerCloudContainers/slicer-gui-gpu](https://github.com/lassoan/SlicerCloudContainers/tree/main/slicer-gui-gpu).

## Compose profile

This service is **optional** and does not start with the default stack:

```bash
docker compose --profile slicer-gui build slicer-gui
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

## Optional: Simplified Viewer module

To enable **Use Simplified Viewer** without modifying the upstream `SlicerHeartViewer` repository:

- Set private build args in `.env` (or your deployment environment):
  - `SLICER_HEART_VIEWER_REPO` (private clone URL)
  - `SLICER_HEART_VIEWER_REF` (tag or commit SHA; pinning recommended)
- Recreate the container:

```bash
docker compose --profile slicer-gui build slicer-gui
docker compose --profile slicer-gui up -d --force-recreate slicer-gui
```

At build time, `SimplifiedViewer` is copied into `/opt/slicer-modules/SimplifiedViewer` when `SLICER_HEART_VIEWER_REPO` is configured.

The image also installs the **Sandbox** extension (provides `UserStatistics`, required by SimplifiedViewer). On first container start with a fresh home volume, launch will install Sandbox once if missing.

At runtime, launch checks `${SLICER_SIMPLIFIED_VIEWER_PATH}` (default: `/opt/slicer-modules/SimplifiedViewer`) and falls back to `/home/slicer/data/SimplifiedViewer` for local/manual testing.

## Requirements

- NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- ~15 GB disk for the image build
- NVIDIA Container Toolkit (see below)

## Verify GPU inside the container

```bash
docker exec slicer-gui nvidia-smi
docker compose --profile slicer-gui logs slicer-gui | grep -A5 "GPU Diagnostics"
```
