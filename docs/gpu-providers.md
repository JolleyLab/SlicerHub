# GPU provider plugins (per project)

Projects can select a GPU provider in **Project → GPU Provider** (admins only).

## Providers

| ID | Billing | File sync |
|----|---------|-----------|
| `local` | Uses Docker Compose trame-service | Same host / storage |
| `vast` | Start/Stop billing provisions a Vast instance | HTTPS to trame-service (see below) |

## Vast setup

1. **Build GPU image** (once per trame-service change):

   ```powershell
   docker compose build trame-job
   docker build -f scripts/vast/Dockerfile.vast-gpu -t YOUR_DOCKERHUB/slicer-vast-gpu:latest .
   docker push YOUR_DOCKERHUB/slicer-vast-gpu:latest
   ```

2. **Server env** (`docker-compose.yml`): `VAST_GPU_IMAGE`, optional `VAST_GPU_NAME`, `VAST_MIN_DISK_GB`, `VAST_MIN_CUDA`, `VAST_MAX_DPH`, `VAST_MIN_RELIABILITY` (default `0.98` — avoids flaky hosts that fail with Docker `ping_group_range`), `VAST_SEARCH_JSON` (full JSON filter override), `VAST_RUNTYPE` (default `args` — avoids Vast SSH shim failures on custom images), `GPU_BILLING_IDLE_MINUTES`.
3. **Per project (UI)**: Vast API key only.
4. **Start billing** — provisions GPU; server injects a per-instance sync token into the instance on-start.
5. **Open a file** — backend streams the scene to trame over HTTPS (see [storage.md](storage.md)).
6. **Stop billing** — destroys the Vast instance and invalidates the sync token.

## Billing safeguards (remote providers)

Remote GPU billing mirrors local trame session leases to limit over-billing:

| Mechanism | Default | Behavior |
|-----------|---------|----------|
| Idle auto-stop | 60 min (`GPU_BILLING_IDLE_MINUTES`) | Destroys instance if no activity |
| Wall cap | 8 hr (`GPU_BILLING_MAX_WALL_MINUTES`, `0` = disabled) | Hard stop from provision time |
| Project heartbeat | 60 s (frontend) | `POST /api/projects/:id/gpu/heartbeat` while project page is open |
| Viewer heartbeat | 60 s (existing) | `POST /api/containers/heartbeat` also touches billing when a scene is open |
| Watchdog | 60 s (backend) | Polls running remote instances and auto-stops on idle/wall cap |

Activity is recorded when provisioning completes, a scene is opened, or either heartbeat fires.

## Adding a provider

Implement `backend/src/gpu/providers/<name>/index.js` and register in `backend/src/gpu/registry.js`.
