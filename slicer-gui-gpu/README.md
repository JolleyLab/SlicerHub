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
| Direct (localhost on host) | `http://127.0.0.1:6080/` |
| VNC client | `localhost:5901` (no password by default) |

Project/data files placed on the host under `data/slicer-gui/` appear in Slicer at `/home/slicer/data`.

When **Use Full Slicer** is enabled in My Projects, the app copies the file there and writes `.open-request.json`. The running Slicer instance polls for that file and loads it via the same `ioManager` path as **File → Add Data** / **Load Scene** (no process restart).

## Requirements

- NVIDIA GPU + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- ~15 GB disk for the image build
- NVIDIA Container Toolkit (see below)

## Verify GPU inside the container

```bash
docker exec slicer-gui nvidia-smi
docker compose --profile slicer-gui logs slicer-gui | grep -A5 "GPU Diagnostics"
```
