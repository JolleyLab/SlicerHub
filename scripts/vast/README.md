# Vast GPU runtime assets

Files baked into or used on the Vast GPU instance. Provisioning is handled in-app — see [docs/gpu-providers.md](../../docs/gpu-providers.md).

| File | Role |
|------|------|
| `Dockerfile.vast-gpu` | GPU node image (trame-service + nginx) |
| `onstart-process-mode.sh` | Boots trame and nginx on instance start |
| `nginx-gpu-node.conf` | Viewer port proxy on the GPU host |

## Build and push image

From the repo root:

```powershell
docker compose build trame-job
docker build -f scripts/vast/Dockerfile.vast-gpu -t YOUR_DOCKERHUB/slicer-vast-gpu:latest .
docker push YOUR_DOCKERHUB/slicer-vast-gpu:latest
```

Set `VAST_GPU_IMAGE=YOUR_DOCKERHUB/slicer-vast-gpu:latest` on the backend.

Optional PowerShell wrapper and manual provision scripts live outside the repo in `../Dev Tools/vast/` (sibling of `slicer-web`).
