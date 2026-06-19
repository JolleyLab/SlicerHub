If server reboots, it should restart. However if it doesn't:
cd /SlicerWeb/
docker compose up -d

Optional full 3D Slicer GUI (local GPU, noVNC — not wired to My Projects yet):
```bash
docker compose --profile slicer-gui build slicer-gui
docker compose --profile slicer-gui up -d slicer-gui
# Open http://<host>:8000/slicer-gui/ — auto-connects, no VNC password
```

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
