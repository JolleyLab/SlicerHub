If server reboots, it should restart. However if it doesn't:
cd /SlicerWeb/
docker compose up -d

Optional full 3D Slicer GUI (local GPU, My Projects **Use Full Slicer**):

```bash
# Build the image once (required). Per-user sessions are started on demand by the backend.
docker compose --profile slicer-gui build slicer-gui

# Optional shared debug container only:
docker compose --profile slicer-gui up -d --force-recreate slicer-gui
```

Local multi-user (My Projects):
- Each user gets `slicer-gui-{userId}` on `trame-net`
- Browser path: `/slicer-gui/user-{userId}/vnc.html` (via nginx)
- Staging dir: `data/slicer-gui/users/{userId}/`
- Requires `HOST_WORKSPACE_ROOT` (set in `.env` for Windows Docker Desktop)
- Image must exist as `SLICER_GUI_IMAGE` (default `slicer-web-slicer-gui:local`)
- Viewer tab sends heartbeats; closing the tab stops the container. Orphaned sessions expire after `VIEWER_SESSION_TTL_SECONDS` (default 120s). Trame and Full Slicer share the same backend session lease/watchdog (`backend/src/sessions/`).
- Logout or auth idle expiry cleans up that user's **local** Trame + Full Slicer containers (Vast billing is unchanged).

Optional Simplified Viewer support for Full Slicer:
- **Image build** (server/Vast): set `SLICER_HEART_VIEWER_REPO` (+ optional `SLICER_HEART_VIEWER_REF`), then `docker compose --profile slicer-gui build --no-cache slicer-gui`
- **Local dev mount** (no rebuild): set `SLICER_HEART_VIEWER_LOCAL_PATH` to your `SimplifiedViewer` folder (backend mounts it into each session container)
- For the shared debug container only, also use `docker-compose.slicer-gui-dev.yml`
- In My Projects, enable **Use Full Slicer** + **Use Simplified Viewer**

Can run alongside legacy `slicer-app-1` on host `:6080` — `slicer-gui` does not publish 6080/5901 on the host.
Manual legacy viewer (if still running): `http://<host>:6080/vnc.html`

What works on ssh02 server today:
- light mode, dark mode (under user preferences)
- launch local viewer from My files
- share link from My Files (read only viewer)
- From My Projects:
  - launch local viewer
  - **Local + "Use Full Slicer"** opens a per-user GPU Slicer session in a new tab and auto-loads the project file
  - launch vast.ai viewer
    - from expanded GPU Provider tab, information button contains link to vast.ai console
    - vast instances will timeout after 10 minutes of inactivity
    - vast.ai instances have an 8 hour wall time

What doesn't work on ssh02 server today:
 - save changes on vast.ai viewer
 - remote/Vast Full Slicer (local sessions only for now)
