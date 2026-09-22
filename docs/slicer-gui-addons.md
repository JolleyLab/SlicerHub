# Full Slicer GUI addons (extensions + scripted modules)

**Audience:** operators setting up Full Slicer on a GPU host (laptop, on-prem, Vast, or Azure N-series).  
**Related:** [slicer-gui-gpu/README.md](../slicer-gui-gpu/README.md), [cloud-hosting-plan.md](./cloud-hosting-plan.md) (app cloud vs GPU plane).

## Goal

Keep Sandbox, SlicerHeart, SimplifiedViewer (and future modules) **up to date without pushing a new Docker image** for every change. All users share one daily snapshot so seats stay in sync.

| Layer | Updates when | Mechanism |
|---|---|---|
| **Base image** (CUDA + Slicer + noVNC) | Rarely (Slicer/CUDA upgrade) | Build `Dockerfile.base` or pull Hub/GHCR |
| **Adapter image** (launch/session scripts) | Rarely (product wiring changes) | Build `Dockerfile` `FROM` base |
| **Addons** (catalog extensions + scripted modules) | **Daily** (or webhook) | Host sync into `data/slicer-addons/` |

Manifest: [`slicer-gui-gpu/slicer-addons.json`](../slicer-gui-gpu/slicer-addons.json).

---

## What lives where

```
data/slicer-addons/           # host tree (not in the image registry)
  .last-sync                  # stamp — seats mount sync only after this exists
  slicer-addons.json          # copy of manifest from last sync
  modules/<Name>/             # scripted modules (git)
  slicer.org/                 # Extension Index packages (Extension Manager)
```

New Full Slicer seats mount that tree read-only and set `SLICER_ADDONS_SYNC=1` (no Extension Index call on seat start). Until the first successful sync, seats use the **bootstrap bake** inside the adapter image.

---

## Setup right now (local / existing GPU host)

### 1. One-time: build images

```powershell
cd slicer-web/slicer-gui-gpu
.\build.ps1
# or: docker compose --profile slicer-gui build slicer-gui-base slicer-gui
```

Ensure `.env` has at least:

```bash
SLICER_GUI_IMAGE=slicer-web-slicer-gui:local
HOST_WORKSPACE_ROOT=/path/on/host/to/slicer-web   # required for Docker Desktop binds
# Scripted modules (optional but needed for SimplifiedViewer via sync):
SLICER_HEART_VIEWER_REPO=git@github.com:org/SlicerHeartViewer.git
SLICER_HEART_VIEWER_REF=main   # pin a tag/SHA in production
```

Backend compose already mounts `./data/slicer-addons` and can pass `SLICER_ADDONS_HOST_DIR` if you store the tree elsewhere.

### 2. First sync (and whenever you want a fresh snapshot)

```powershell
cd slicer-web/slicer-gui-gpu
.\sync-slicer-addons.ps1
```

Linux:

```bash
cd slicer-web/slicer-gui-gpu
./sync-slicer-addons.sh
# or: python3 sync-slicer-addons.py
```

Requires: Docker, git, Python 3; `SLICER_GUI_IMAGE` already built or pulled. Sync uses a **one-shot** container (`docker run --entrypoint '' …`) to refresh catalog extensions into the host `slicer.org` folder — it does **not** push to Docker Hub.

### 3. Schedule daily updates

**Linux (cron example — 04:00 local):**

```cron
0 4 * * * cd /path/to/slicer-web/slicer-gui-gpu && /usr/bin/python3 sync-slicer-addons.py >> /var/log/slicer-addons-sync.log 2>&1
```

**Windows:** Task Scheduler → daily → `powershell -File …\sync-slicer-addons.ps1`.

**Webhook (optional):** on module-repo merge, call the same script on the GPU host (SSH, Azure Run Command, or a tiny agent). Do **not** rebuild/push the adapter image for routine module commits.

### 4. Verify

- `data/slicer-addons/.last-sync` exists and lists extensions/modules.
- Open Full Slicer for a user; backend logs should mention host addons sync.
- Recreate seats after a sync to pick up the new snapshot (running seats keep the old process).

---

## When the published Slicer base image is ready

No change to the daily sync model:

```bash
# .env on the GPU host / build machine
SLICER_GUI_BASE_IMAGE=ghcr.io/example/slicer-gui-gpu:5.10   # example
SLICER_GUI_BUILD_BASE=false
SLICER_GUI_IMAGE=slicer-web-slicer-gui:5.10                 # your adapter tag
```

1. Rebuild **adapter only** once (`.\build.ps1` or compose build `slicer-gui`).  
2. Keep running `sync-slicer-addons` daily against that `SLICER_GUI_IMAGE`.  
3. Push the adapter to a private registry only when **adapter/base** changes — not for daily addon bumps.

---

## Adding a new scripted module

1. Add an entry under `modules` in `slicer-addons.json` (`name`, `subdir`, `entry_py`, `repo_env`, `ref_env`).  
2. Set the repo/ref env vars on the GPU host.  
3. Run `sync-slicer-addons` (no image rebuild required for seat mounts).  
4. Rebuild the adapter only if you still want the module **baked** as bootstrap for hosts that have never synced.

Catalog packages: add the Extension Index name to `extensions` and sync.

---

## Azure (and similar) GPU hardware

The [cloud hosting plan](./cloud-hosting-plan.md) puts the **app** on Azure Container Apps / AWS Fargate. **Full Slicer GPU is a separate plane** (client- or org-provided). On Azure that typically looks like:

### Recommended shape

| Piece | Azure example | Role |
|---|---|---|
| App control plane | Container Apps + ACR + PostgreSQL + Blob | Auth, Cases, session start API — **no** daily Slicer addon rebuild |
| GPU VM / VMSS | **NCasT4_v3** / **NC** / **NV** series (NVIDIA + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)) | Runs `SLICER_GUI_IMAGE` seats + holds `data/slicer-addons` |
| Disk | Premium SSD (or Azure Files) on the GPU VM | Persist `data/slicer-addons` and per-user `data/slicer-gui` |
| Image store | **Azure Container Registry** | Store base/adapter images when you rebuild them (rare) |
| Secrets | Key Vault / VM env | `SLICER_HEART_VIEWER_REPO` credentials, registry login |
| Daily sync | cron on the VM, or **Azure Automation** / scheduled **Run Command**, or GitHub Actions → SSH/Run Command | Runs `sync-slicer-addons.py` on the GPU host |
| Optional webhook | Module repo Actions → `az vm run-command` / SSH | Same sync script; still no image push |

```
GitHub (module merge or nightly)
        │
        ▼
  sync-slicer-addons on GPU VM  ──writes──►  /data/slicer-addons/
        │
        ▼
  Backend (Container Apps) starts slicer-gui-{user}-seatN
        │  docker -v hostAddons/modules:/opt/slicer-modules:ro
        │  docker -v hostAddons/slicer.org:/home/slicer/slicer.org:ro
        ▼
  User browser ← noVNC
```

### What you do **not** need on Azure for daily addon updates

- Pushing a new image to ACR/Docker Hub every day  
- Rebuilding Container Apps  
- Per-seat Extension Manager downloads (those happen in the daily sync job)

### Networking notes

- GPU VM must reach the Extension Index (outbound HTTPS) during **sync**, and your git host for scripted modules.  
- Seats should **not** need Extension Index access if sync succeeded (`SLICER_ADDONS_SYNC=1`).  
- App ↔ GPU: same pattern as today (backend with Docker socket on a Docker host, or a remote GPU API later). Sync is always **local to the machine that runs the seats**.

### Minimal Azure operator checklist

1. Provision NVIDIA VM; install Docker + NVIDIA Container Toolkit.  
2. Clone/deploy `slicer-web` (or at least `slicer-gui-gpu` + sync env).  
3. Pull or build `SLICER_GUI_IMAGE`; configure `.env`.  
4. Run first `sync-slicer-addons`; confirm `.last-sync`.  
5. Schedule daily sync; optionally wire module-repo webhook.  
6. Point the app backend at this host for Full Slicer (`SLICER_GUI_IMAGE`, `HOST_WORKSPACE_ROOT` / bind paths as required).

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Seats ignore sync | Missing `data/slicer-addons/.last-sync`; backend volume `./data/slicer-addons` |
| SimplifiedViewer missing after sync | `SLICER_HEART_VIEWER_REPO` unset → modules dir empty → image bake used only if modules mount skipped |
| Extension sync fails in script | Image name, network from host, `docker run` logs; seats can still use prior `slicer.org` |
| Want image bake only | Delete `.last-sync` (or empty host dir); seats fall back to baked addons |

---

## See also

- [`slicer-gui-gpu/sync-slicer-addons.py`](../slicer-gui-gpu/sync-slicer-addons.py)  
- [`slicer-gui-gpu/slicer-addons.json`](../slicer-gui-gpu/slicer-addons.json)  
- [DEMO-README.md](./DEMO-README.md) — quick local Full Slicer notes  
