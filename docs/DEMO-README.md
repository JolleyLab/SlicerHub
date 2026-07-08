If server reboots, it should restart. However if it doesn't:
cd /SlicerWeb/
docker compose up -d

Optional full 3D Slicer GUI (local GPU, My Projects **Use Full Slicer**):
```bash
docker compose --profile slicer-gui build slicer-gui
docker compose --profile slicer-gui up -d --force-recreate slicer-gui
# App / My Projects: http://<host>:8000/slicer-gui/vnc.html (via nginx, no host ports)
```

Optional Simplified Viewer support for Full Slicer:
- **Image build** (server/Vast): set `SLICER_HEART_VIEWER_REPO` (+ optional `SLICER_HEART_VIEWER_REF`), then `docker compose --profile slicer-gui build --no-cache slicer-gui`
- **Local dev mount** (no rebuild): set `SLICER_HEART_VIEWER_LOCAL_PATH` to your `SimplifiedViewer` folder, then:
  `docker compose -f docker-compose.yml -f docker-compose.slicer-gui-dev.yml --profile slicer-gui up -d --force-recreate slicer-gui`
- In My Projects, enable **Use Full Slicer** + **Use Simplified Viewer**

Can run alongside legacy `slicer-app-1` on host `:6080` — `slicer-gui` does not publish 6080/5901 on the host.
Manual legacy viewer (if still running): `http://<host>:6080/vnc.html`

What works on ssh02 server today:
- light mode, dark mode (under user preferences)
- launch local viewer from My files 
- share link from My Files (read only viewer)
- From My Projects:
  - launch local viewer
  - **Local + "Use Full Slicer"** opens standalone GPU Slicer in a new tab and auto-loads the project file
  - launch vast.ai viewer
    - from expanded GPU Provider tab, information button contains link to vast.ai console
    - vast instances will timeout after 10 minutes of inactivity
    - vast.ai instances have an 8 hour wall time

What doesn't work on ssh02 server today:
 - save changes on vast.ai viewer
 - simplified slicer heart viewer
