"""Poll for staged open requests and load in the running Slicer process."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import traceback
import zipfile

import slicer
from qt import QTimer

REQUEST_FILE = "/home/slicer/data/.open-request.json"
BUSY_FILE = "/home/slicer/data/.slicer-busy"
READY_FILE = "/home/slicer/data/.slicer-ready"
LAST_LOADED_FILE = "/home/slicer/data/.last-loaded.json"
SCENE_LOADED_FILE = "/home/slicer/data/.scene-loaded.json"
LOAD_RESULT_FILE = "/home/slicer/data/.load-result.json"
LOG_FILE = "/home/slicer/data/slicer-session.log"
POLL_MS = 250
MAX_LOAD_ATTEMPTS = 30
# Failures that will not recover by retrying the same request.
PERMANENT_LOAD_MARKERS = (
    "CreateNodeByClass",
    "Failed to load node from file",
)
# Optional MRML view nodes saved into scenes when extensions were present.
STRIP_MRML_TAGS = (
    "VirtualRealityView",
    "ChartView",
)
_OVERLAY_HOLD_MS = 1800
_busy = False
_failed_attempts: dict[str, int] = {}
_last_completed_key = ""
_ui_wait_logged = False
_poll_timer = None
_load_overlay = None
_overlay_raise_timer = None
_viewer_mode_simplified: bool | None = None
_ready_timer = None
_ready_announced = False
_last_load_error = ""


def log(message: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def read_request() -> dict | None:
    if not os.path.isfile(REQUEST_FILE):
        return None
    try:
        with open(REQUEST_FILE, encoding="utf-8") as handle:
            payload = json.load(handle)
        path = (payload.get("containerPath") or "").strip()
        if not path:
            return None
        payload["containerPath"] = path
        return payload
    except (OSError, json.JSONDecodeError) as exc:
        log(f"[slicer_session] Invalid request file: {exc}")
        return None


def request_key(payload: dict) -> str:
    file_id = payload.get("fileId", "")
    requested_at = (payload.get("requestedAt") or "").strip()
    path = (payload.get("containerPath") or "").strip()
    simplified = "1" if payload.get("useSimplifiedViewer") is True else "0"
    return f"{file_id}:{requested_at}:{path}:{simplified}"


def should_process_request(payload: dict) -> bool:
    global _last_completed_key
    key = request_key(payload)
    if key == _last_completed_key:
        # Never re-process a completed request. Stale files (Windows bind mounts,
        # failed unlink) must be dropped or the seat reload-loops forever.
        if os.path.isfile(REQUEST_FILE):
            log(f"[slicer_session] Clearing stale completed request: {key}")
            clear_request()
        return False
    return True


def claim_open_request() -> tuple:
    """
    Read and immediately remove the open-request file.

    The poller calls processEvents during loads; if the request file remains on
    disk, a re-entrant poll restarts the same MRB forever (progress flicker).
    Claiming first makes re-entrant polls see an empty queue.
    """
    global _last_completed_key
    payload = read_request()
    if not payload:
        return None, ""
    key = request_key(payload)
    if key == _last_completed_key:
        clear_request()
        return None, key
    clear_request()
    return payload, key


def wait_file_readable(path: str, timeout_s: float = 90.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if os.path.isfile(path) and os.access(path, os.R_OK):
            size = os.path.getsize(path)
            if size > 0:
                return True
        # Keep the Qt event loop alive (poll timer, view refresh timers).
        end = time.time() + 0.05
        while time.time() < end:
            slicer.app.processEvents()
    return False


def ui_ready() -> bool:
    layout_manager = slicer.app.layoutManager()
    return bool(layout_manager and layout_manager.sliceWidget("Red"))


def iter_nodes(class_name: str) -> list:
    nodes = slicer.util.getNodesByClass(class_name)
    if isinstance(nodes, dict):
        return list(nodes.values())
    return list(nodes or [])


def count_data_nodes() -> int:
    total = 0
    for class_name in (
        "vtkMRMLScalarVolumeNode",
        "vtkMRMLLabelMapVolumeNode",
        "vtkMRMLSegmentationNode",
        "vtkMRMLModelNode",
    ):
        total += len(iter_nodes(class_name))
    return total


def run_window_size_sync() -> None:
    try:
        subprocess.run(
            ["/usr/local/bin/apply-slicer-window-size.sh"],
            env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":1")},
            check=False,
            timeout=15,
        )
    except Exception as exc:
        log(f"[slicer_session] apply-slicer-window-size failed: {exc}")


def selection_volume_id(selection) -> str:
    """Active volume id from the selection node (API differs across Slicer builds)."""
    if selection is None:
        return ""
    try:
        volume_id = selection.GetActiveVolumeID() or ""
    except Exception:
        volume_id = ""
    if volume_id:
        return volume_id
    getter = getattr(selection, "GetReferenceActiveVolumeID", None)
    if not callable(getter):
        return ""
    try:
        return getter() or ""
    except Exception:
        return ""


def set_selection_volume_id(selection, volume_id: str) -> None:
    if selection is None or not volume_id:
        return
    try:
        selection.SetActiveVolumeID(volume_id)
    except Exception:
        pass
    setter = getattr(selection, "SetReferenceActiveVolumeID", None)
    if callable(setter):
        try:
            setter(volume_id)
        except Exception:
            pass


def refresh_slice_views(*, fit: bool = True) -> None:
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return

    # Soft refresh: forceRender only — fit resets slice offsets after scroll.
    if not fit:
        for _name, widget in iter_slice_widgets():
            try:
                widget.sliceView().forceRender()
            except Exception:
                pass
        slicer.app.processEvents()
        return

    app_logic = slicer.app.applicationLogic()
    selection = app_logic.GetSelectionNode()
    volume_id = selection_volume_id(selection)
    volume = slicer.mrmlScene.GetNodeByID(volume_id) if volume_id else None

    if volume is None:
        for class_name in ("vtkMRMLScalarVolumeNode", "vtkMRMLLabelMapVolumeNode"):
            nodes = iter_nodes(class_name)
            if nodes:
                volume = nodes[0]
                volume_id = volume.GetID()
                break

    if volume_id and volume and selection is not None:
        set_selection_volume_id(selection, volume_id)
        try:
            app_logic.PropagateVolumeSelection(0)
        except Exception:
            pass
        try:
            slicer.util.setSliceViewerLayers(background=volume, fit=True)
        except Exception:
            pass

    if hasattr(app_logic, "FitSliceToAll"):
        try:
            app_logic.FitSliceToAll(True, False)
        except Exception:
            pass

    slicer.app.processEvents()


def iter_slice_widgets():
    """Yield (name, widget) for every slice view in the current layout."""
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    names = []
    try:
        names = list(layout_manager.sliceViewNames() or [])
    except Exception:
        names = []
    if not names:
        names = ["Red", "Yellow", "Green"]
    seen = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        try:
            widget = layout_manager.sliceWidget(name)
        except Exception:
            widget = None
        if widget is not None:
            yield name, widget


def force_render_all_views() -> None:
    """Re-paint without changing camera, FOV, or slice offsets."""
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    for _name, widget in iter_slice_widgets():
        try:
            widget.sliceView().forceRender()
        except Exception:
            pass
    for index in range(getattr(layout_manager, "threeDViewCount", 0) or 0):
        widget = layout_manager.threeDWidget(index)
        if not widget:
            continue
        try:
            widget.threeDView().forceRender()
        except Exception:
            pass
    if hasattr(slicer.util, "forceRenderAllViews"):
        slicer.util.forceRenderAllViews()
    slicer.app.processEvents()


def volume_from_vr_display_node(display_node):
    if hasattr(display_node, "GetDisplayableNode"):
        return display_node.GetDisplayableNode()
    volume_id = display_node.GetDisplayableNodeID() if hasattr(display_node, "GetDisplayableNodeID") else ""
    return slicer.mrmlScene.GetNodeByID(volume_id) if volume_id else None


def refresh_three_d_views(*, reset_camera: bool = False) -> None:
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return

    three_d_view_ids: list[str] = []
    for index in range(layout_manager.threeDViewCount):
        widget = layout_manager.threeDWidget(index)
        if not widget:
            continue
        view = widget.threeDView()
        view_node = view.mrmlViewNode()
        if not view_node:
            continue
        three_d_view_ids.append(view_node.GetID())
        # Soft refresh: skip visibility toggle (flashes blank over VNC).
        if reset_camera:
            visible = view_node.GetVisibility()
            view_node.SetVisibility(False)
            view_node.SetVisibility(visible)
            view_node.Modified()

    vol_ren_logic = getattr(getattr(slicer.modules, "volumerendering", None), "logic", lambda: None)()
    if vol_ren_logic:
        for display_node in iter_nodes("vtkMRMLVolumeRenderingDisplayNode"):
            volume = volume_from_vr_display_node(display_node)
            display_node.SetVisibility(True)
            for view_id in three_d_view_ids:
                if hasattr(display_node, "IsViewNodeIDPresent"):
                    if not display_node.IsViewNodeIDPresent(view_id):
                        display_node.AddViewNodeID(view_id)
                else:
                    display_node.AddViewNodeID(view_id)
            display_node.Modified()
            if volume and hasattr(vol_ren_logic, "UpdateVolumeRenderingDisplayNode"):
                try:
                    vol_ren_logic.UpdateVolumeRenderingDisplayNode(display_node, volume)
                except Exception:
                    pass

    for seg_node in iter_nodes("vtkMRMLSegmentationNode"):
        display = seg_node.GetDisplayNode()
        if display:
            display.Modified()
        for index in range(seg_node.GetNumberOfDisplayNodes()):
            display = seg_node.GetNthDisplayNode(index)
            if display:
                display.Modified()

    for model_node in iter_nodes("vtkMRMLModelNode"):
        display = model_node.GetDisplayNode()
        if display:
            display.Modified()

    for index in range(layout_manager.threeDViewCount):
        widget = layout_manager.threeDWidget(index)
        if not widget:
            continue
        view = widget.threeDView()
        # Only reset camera on initial reveal.
        if reset_camera:
            view.resetFocalPoint()
            view.resetCamera()
            if hasattr(view, "resetCameraClippingRange"):
                view.resetCameraClippingRange()
        view.forceRender()

    if hasattr(slicer.util, "forceRenderAllViews"):
        slicer.util.forceRenderAllViews()

    slicer.app.processEvents()


def refresh_all_views(*, fit: bool = True, reset_camera: bool = False) -> None:
    refresh_slice_views(fit=fit)
    refresh_three_d_views(reset_camera=reset_camera)


def schedule_view_refresh() -> None:
    # Custom layouts: skip FitSliceToAll (preserves MRB FOVs).
    layout_id = None
    try:
        layout_id = int(slicer.app.layoutManager().layout)
    except Exception:
        layout_id = None
    simple_layouts = {2, 3, 4, 5, 6, 7, 8}
    do_fit = layout_id in simple_layouts if layout_id is not None else False
    refresh_all_views(fit=do_fit, reset_camera=False)
    if do_fit:
        QTimer.singleShot(500, force_render_all_views)
        QTimer.singleShot(1500, force_render_all_views)
    else:
        QTimer.singleShot(400, force_render_all_views)
    QTimer.singleShot(800, run_window_size_sync)


# SlicerHeart layouts 1512/1513 (MRBs store ID only; XML registered here).
CARDIAC_FOURUP_LAYOUT_ID = 1512
CARDIAC_EIGHTUP_LAYOUT_ID = 1513
_CARDIAC_FOURUP_LAYOUT_XML = (
    '<layout type="vertical">'
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Green">'
    '     <property name="orientation" action="default">Coronal</property>'
    '     <property name="viewlabel" action="default">G</property>'
    '     <property name="viewcolor" action="default">#6EB04B</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Yellow">'
    '     <property name="orientation" action="default">Sagittal</property>'
    '     <property name="viewlabel" action="default">Y</property>'
    '     <property name="viewcolor" action="default">#EDD54C</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Red">'
    '     <property name="orientation" action="default">Axial</property>'
    '     <property name="viewlabel" action="default">R</property>'
    '     <property name="viewcolor" action="default">#F34A33</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLViewNode" singletontag="1">'
    '     <property name="viewlabel" action="default">1</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    "</layout>"
)
_CARDIAC_EIGHTUP_LAYOUT_XML = (
    '<layout type="horizontal" split="true">'
    "<item>"
    '<layout type="vertical">'
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Green">'
    '     <property name="orientation" action="default">Coronal</property>'
    '     <property name="viewlabel" action="default">G</property>'
    '     <property name="viewcolor" action="default">#6EB04B</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Yellow">'
    '     <property name="orientation" action="default">Sagittal</property>'
    '     <property name="viewlabel" action="default">Y</property>'
    '     <property name="viewcolor" action="default">#EDD54C</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Red">'
    '     <property name="orientation" action="default">Axial</property>'
    '     <property name="viewlabel" action="default">R</property>'
    '     <property name="viewcolor" action="default">#F34A33</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLViewNode" singletontag="1">'
    '     <property name="viewlabel" action="default">1</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    "</layout>"
    "</item>"
    "<item>"
    '<layout type="vertical">'
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Slice6">'
    '     <property name="orientation" action="default">Coronal</property>'
    '     <property name="viewlabel" action="default">GS</property>'
    '     <property name="viewcolor" action="default">#6EB04B</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Slice5">'
    '     <property name="orientation" action="default">Sagittal</property>'
    '     <property name="viewlabel" action="default">YS</property>'
    '     <property name="viewcolor" action="default">#EDD54C</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    " <item>"
    '  <layout type="horizontal">'
    "   <item>"
    '    <view class="vtkMRMLSliceNode" singletontag="Slice4">'
    '     <property name="orientation" action="default">Axial</property>'
    '     <property name="viewlabel" action="default">RS</property>'
    '     <property name="viewcolor" action="default">#F34A33</property>'
    "    </view>"
    "   </item>"
    "   <item>"
    '    <view class="vtkMRMLViewNode" singletontag="1S">'
    '     <property name="viewlabel" action="default">1S</property>'
    "    </view>"
    "   </item>"
    "  </layout>"
    " </item>"
    "</layout>"
    "</item>"
    "</layout>"
)


def ensure_slicerheart_layouts() -> bool:
    """Register Cardiac Four-Up/Eight-Up (1512/1513) if missing."""
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return False
    layout_node = layout_manager.layoutLogic().GetLayoutNode()
    if layout_node is None:
        return False

    for layout_id, xml in (
        (CARDIAC_FOURUP_LAYOUT_ID, _CARDIAC_FOURUP_LAYOUT_XML),
        (CARDIAC_EIGHTUP_LAYOUT_ID, _CARDIAC_EIGHTUP_LAYOUT_XML),
    ):
        try:
            if hasattr(layout_node, "IsLayoutDescription") and layout_node.IsLayoutDescription(
                layout_id
            ):
                continue
        except Exception:
            pass
        try:
            layout_node.AddLayoutDescription(layout_id, xml)
        except Exception as exc:
            log(f"[slicer_session] Failed to register layout {layout_id}: {exc}")
    return True


# Custom layout ID → extension for quiet on-demand install.
LAYOUT_EXTENSION_HINTS: dict[int, str] = {
    CARDIAC_FOURUP_LAYOUT_ID: "SlicerHeart",
    CARDIAC_EIGHTUP_LAYOUT_ID: "SlicerHeart",
}


def _layout_is_described(layout_node, layout_id: int) -> bool:
    try:
        if hasattr(layout_node, "IsLayoutDescription"):
            return bool(layout_node.IsLayoutDescription(layout_id))
    except Exception:
        pass
    try:
        desc = layout_node.GetLayoutDescription(layout_id)
        return bool(desc and str(desc).strip())
    except Exception:
        return False


def _reapply_layout(layout_id: int) -> None:
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    try:
        # Built-in bounce so Qt recreates GL widgets.
        layout_manager.setLayout(3)
        slicer.app.processEvents()
        layout_manager.setLayout(layout_id)
        slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] Could not re-apply layout {layout_id}: {exc}")


def install_extension_quiet(name: str) -> bool:
    """Install extension without restart (splash stays visible)."""
    try:
        em = slicer.app.extensionsManagerModel()
        em.interactive = False
    except Exception as exc:
        log(f"[slicer_session] Extensions manager unavailable: {exc}")
        return False

    try:
        if em.isExtensionInstalled(name):
            return True
    except Exception:
        pass

    set_load_overlay_message(
        "Preparing viewer…",
        "Getting everything ready for this project…",
    )
    log(f"[slicer_session] Installing extension: {name}")
    try:
        em.updateExtensionsMetadataFromServer(True, True)
    except Exception as exc:
        log(f"[slicer_session] Extension metadata update warning: {exc}")

    ok = False
    try:
        if hasattr(em, "installExtensionFromServer"):
            ok = bool(em.installExtensionFromServer(name, False))
        elif hasattr(em, "downloadAndInstallExtensionByName"):
            ok = bool(em.downloadAndInstallExtensionByName(name, True, False))
    except Exception as exc:
        log(f"[slicer_session] Extension install failed ({name}): {exc}")
        return False

    if not ok:
        log(f"[slicer_session] Extension install returned false: {name}")
    return ok


def _try_load_extension_modules() -> None:
    try:
        factory = slicer.app.moduleManager().factoryManager()
        if hasattr(factory, "loadModules"):
            factory.loadModules()
        slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] Module reload after extension install: {exc}")
    try:
        import HeartValveLib

        HeartValveLib.registerCustomLayouts()
    except Exception:
        pass


def ensure_scene_layout_ready() -> None:
    """Register/install the scene layout if missing; fall back to FourUp."""
    ensure_slicerheart_layouts()
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    layout_node = layout_manager.layoutLogic().GetLayoutNode()
    if layout_node is None:
        return
    try:
        layout_id = int(layout_manager.layout)
    except Exception:
        return

    if layout_id < 100 or layout_id in {2, 3, 4, 5, 6, 7, 8}:
        return

    if _layout_is_described(layout_node, layout_id):
        _reapply_layout(layout_id)
        return

    extension = LAYOUT_EXTENSION_HINTS.get(layout_id)
    if extension:
        set_load_overlay_message(
            "Preparing viewer…",
            "Getting everything ready for this project…",
        )
        log(
            f"[slicer_session] Layout {layout_id} not registered; "
            f"ensuring extension {extension}"
        )
        install_extension_quiet(extension)
        _try_load_extension_modules()
        ensure_slicerheart_layouts()

    if _layout_is_described(layout_node, layout_id):
        set_load_overlay_message("Opening viewer…", "Please wait while the scene loads.")
        _reapply_layout(layout_id)
        return

    set_load_overlay_message(
        "Opening viewer…",
        "Using a standard layout for this session…",
    )
    log(
        f"[slicer_session] Layout {layout_id} still unavailable after prep; "
        "falling back to FourUp"
    )
    try:
        layout_manager.setLayout(3)
        slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] FourUp fallback failed: {exc}")


def reapply_scene_layout_if_needed() -> None:
    ensure_scene_layout_ready()


def ensure_simplified_viewer_module_path() -> None:
    """Register SimplifiedViewer with the module factory if the .py is on disk."""
    try:
        import sys
        if "/usr/local/bin" not in sys.path:
            sys.path.insert(0, "/usr/local/bin")
        from slicer_addons import discovery_path_for_module_dir, simplified_viewer_module_dirs
        module_dirs = simplified_viewer_module_dirs()
    except Exception as exc:
        log(f"[slicer_session] Could not resolve SimplifiedViewer paths: {exc}")
        module_dirs = []
        for candidate in (
            os.environ.get("SLICER_SIMPLIFIED_VIEWER_PATH", "").strip(),
            "/opt/slicer-modules/SimplifiedViewer",
            "/home/slicer/data/SimplifiedViewer",
        ):
            if candidate and os.path.isfile(os.path.join(candidate, "SimplifiedViewer.py")):
                module_dirs.append(candidate)

    if not module_dirs:
        log("[slicer_session] SimplifiedViewer.py not found on known module paths")
        return

    search_dirs = []
    for module_dir in module_dirs:
        path = module_dir if isinstance(module_dir, str) else str(module_dir)
        try:
            from pathlib import Path
            parent = str(discovery_path_for_module_dir(Path(path)))
        except Exception:
            parent = os.path.dirname(path.rstrip("/"))
        for search_dir in (parent, path):
            if search_dir and search_dir not in search_dirs:
                search_dirs.append(search_dir)

    try:
        from qt import QSettings
        settings = QSettings()
        existing = settings.value("Modules/AdditionalPaths") or []
        if isinstance(existing, str):
            existing = [existing] if existing else []
        paths = [str(path) for path in existing]
        changed = False
        for search_dir in search_dirs:
            if search_dir not in paths:
                paths.append(search_dir)
                changed = True
        if changed:
            settings.setValue("Modules/AdditionalPaths", paths)
            settings.sync()
    except Exception as exc:
        log(f"[slicer_session] Could not update Modules/AdditionalPaths: {exc}")

    try:
        factory = slicer.app.moduleManager().factoryManager()
        for search_dir in search_dirs:
            if hasattr(factory, "addSearchPath"):
                factory.addSearchPath(search_dir)
            elif hasattr(factory, "addSearchPaths"):
                factory.addSearchPaths([search_dir])
            else:
                paths = list(getattr(factory, "searchPaths", []) or [])
                if search_dir not in paths:
                    paths.append(search_dir)
                    factory.searchPaths = paths
        if hasattr(factory, "registerModules"):
            factory.registerModules()
        if hasattr(factory, "instantiateModules"):
            factory.instantiateModules()
        if hasattr(factory, "loadModules"):
            factory.loadModules()
        slicer.app.processEvents()
        log(f"[slicer_session] SimplifiedViewer search paths ensured: {search_dirs}")
    except Exception as exc:
        log(f"[slicer_session] Module factory refresh failed: {exc}")


def module_is_registered(name: str) -> bool:
    target = name.lower()
    try:
        names = [n.lower() for n in slicer.app.moduleManager().modulesNames()]
        if target in names:
            return True
    except Exception:
        pass
    return hasattr(slicer.modules, target) or hasattr(slicer.modules, name)


def enable_developer_mode() -> None:
    """Enable Slicer developer mode (reload UI, SimplifiedViewer full-interface action)."""
    try:
        from qt import QSettings
        settings = QSettings()
        settings.setValue("Developer/DeveloperMode", True)
        settings.sync()
    except Exception as exc:
        log(f"[slicer_session] Could not enable DeveloperMode: {exc}")


def enable_simplified_viewer_developer_ui(widget) -> None:
    """developerMode is snapshotted at widget init; force UI bits after we enable settings.

    SimplifiedViewer only adds the Settings gear when developerMode is true during setup().
    If the widget was created before DeveloperMode was enabled, re-parent the gear now.
    """
    if widget is None:
        return
    try:
        widget.developerMode = True
        action = getattr(widget, "fullSlicerInterfaceAction", None)
        if action is not None:
            action.setVisible(True)

        settings_button = getattr(widget, "settingsButton", None)
        top_left = getattr(widget, "topLeftWidget", None)
        if settings_button is not None and top_left is not None:
            parent = settings_button.parent()
            if parent is None or parent != top_left:
                layout = top_left.layout()
                if layout is not None:
                    button_size = getattr(widget, "buttonSize", 40)
                    spacing = getattr(widget, "spacing", 4)
                    settings_button.setFixedSize(button_size, button_size)
                    # Insert before the trailing stretch (last item).
                    insert_at = max(0, layout.count() - 1)
                    layout.insertWidget(insert_at, settings_button)
                    button_count = layout.count() - 1  # exclude stretch
                    if button_count > 0:
                        top_left.setFixedWidth(
                            button_count * button_size + max(0, button_count - 1) * spacing
                        )
                    settings_button.show()
                    top_left.show()

    except Exception as exc:
        log(f"[slicer_session] Could not enable SimplifiedViewer developer UI: {exc}")
        log(traceback.format_exc())


def hide_full_slicer_chrome() -> None:
    """Hide standard Slicer chrome even if SimplifiedViewer widget is unavailable."""
    enable_developer_mode()
    try:
        from qt import QSettings
        settings = QSettings()
        settings.setValue("SimplifiedViewer/FullInterfaceVisible", False)
        settings.setValue("SimplifiedViewer/IdleCloseEnabled", False)
    except Exception:
        pass

    slicer.util.setToolbarsVisible(False)
    slicer.util.setMenuBarsVisible(False)
    slicer.util.setApplicationLogoVisible(False)
    slicer.util.setModuleHelpSectionVisible(False)
    slicer.util.setModulePanelTitleVisible(False)
    slicer.util.setDataProbeVisible(False)
    slicer.util.setStatusBarVisible(False)
    try:
        slicer.util.setModulePanelVisible(False)
    except Exception:
        pass


def _qt_rect(obj, *names: str):
    """Read a Qt geometry property safely under PythonQt (callable vs attribute)."""
    for name in names:
        value = getattr(obj, name, None)
        if value is None:
            continue
        try:
            return value() if callable(value) else value
        except Exception:
            continue
    return None


def use_external_web_splash() -> bool:
    """Prefer the HTML loader splash over an in-Slicer Qt overlay."""
    val = str(os.environ.get("SLICER_WEB_EXTERNAL_SPLASH", "1")).strip().lower()
    return val not in ("0", "false", "no", "off")


def _busy_token_from_message(message: str) -> str:
    lower = (message or "").lower()
    if "prepar" in lower:
        return "preparing"
    if "open" in lower:
        return "opening"
    return "loading"


def show_load_overlay(message: str = "Loading viewer…") -> None:
    """Update busy status; show Qt splash only when external web splash is off."""
    global _load_overlay, _overlay_raise_timer
    set_busy(_busy_token_from_message(message))

    if use_external_web_splash():
        return

    hide_load_overlay()
    try:
        from qt import QWidget, QLabel, QVBoxLayout, Qt

        main_window = slicer.util.mainWindow()
        if not main_window:
            return

        overlay = QWidget(main_window)
        overlay.setObjectName("slicerWebLoadOverlay")
        overlay.setAttribute(Qt.WA_StyledBackground, True)
        overlay.setStyleSheet("background-color: #0c0c14;")
        rect = _qt_rect(main_window, "rect")
        if rect is not None:
            overlay.setGeometry(rect)
        else:
            geo = _qt_rect(main_window, "geometry", "frameGeometry")
            if geo is not None:
                overlay.resize(geo.width(), geo.height())
                overlay.move(0, 0)

        layout = QVBoxLayout(overlay)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.addStretch(1)
        label = QLabel(message)
        label.setObjectName("slicerWebLoadOverlayTitle")
        label.setAlignment(Qt.AlignCenter)
        label.setStyleSheet(
            "color: #e8e8ef; font-size: 20px; font-weight: 600; background: transparent;"
        )
        layout.addWidget(label)
        hint = QLabel("Please wait while the scene loads.")
        hint.setObjectName("slicerWebLoadOverlayHint")
        hint.setAlignment(Qt.AlignCenter)
        hint.setStyleSheet("color: #9aa0b4; font-size: 14px; background: transparent;")
        layout.addWidget(hint)
        layout.addStretch(1)

        overlay.show()
        overlay.raise_()
        _load_overlay = overlay

        _overlay_raise_timer = QTimer()
        _overlay_raise_timer.setInterval(100)
        _overlay_raise_timer.timeout.connect(_keep_overlay_on_top)
        _overlay_raise_timer.start()

        slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] Could not show load overlay: {exc}")
        _load_overlay = None


def set_load_overlay_message(message: str, hint: str | None = None) -> None:
    """Update splash / busy message without tearing down the overlay."""
    set_busy(_busy_token_from_message(message))
    if use_external_web_splash():
        return

    if _load_overlay is None:
        show_load_overlay(message)
    if _load_overlay is None:
        return
    try:
        from qt import QLabel

        title = _load_overlay.findChild(QLabel, "slicerWebLoadOverlayTitle")
        hint_label = _load_overlay.findChild(QLabel, "slicerWebLoadOverlayHint")
        if title is not None:
            title.setText(message)
        if hint is not None and hint_label is not None:
            hint_label.setText(hint)
        _keep_overlay_on_top()
        slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] Could not update load overlay: {exc}")


def _keep_overlay_on_top() -> None:
    if _load_overlay is None:
        return
    try:
        main_window = slicer.util.mainWindow()
        if main_window is not None:
            rect = _qt_rect(main_window, "rect")
            if rect is not None:
                _load_overlay.setGeometry(rect)
        _load_overlay.show()
        _load_overlay.raise_()
    except Exception:
        pass


def hide_load_overlay() -> None:
    global _load_overlay, _overlay_raise_timer
    try:
        if _overlay_raise_timer is not None:
            _overlay_raise_timer.stop()
            _overlay_raise_timer.deleteLater()
            _overlay_raise_timer = None
        if _load_overlay is not None:
            _load_overlay.hide()
            _load_overlay.deleteLater()
            _load_overlay = None
            slicer.app.processEvents()
    except Exception as exc:
        log(f"[slicer_session] Could not hide load overlay: {exc}")
        _load_overlay = None
        _overlay_raise_timer = None


def schedule_hide_load_overlay(delay_ms: int = _OVERLAY_HOLD_MS) -> None:
    """Keep splash up through initial view refreshes before revealing."""
    QTimer.singleShot(max(0, int(delay_ms)), hide_load_overlay)


def find_simplified_viewer_widget():
    candidates = []
    # Avoid slicer.util.getModuleWidget — it logs a loud error when unregistered.
    if module_is_registered("SimplifiedViewer"):
        try:
            candidates.append(slicer.util.getModuleWidget("SimplifiedViewer"))
        except Exception:
            pass

    widget = getattr(slicer.modules, "SimplifiedViewerWidget", None)
    if widget is not None:
        candidates.append(widget)

    module = getattr(slicer.modules, "simplifiedviewer", None)
    if module:
        try:
            widget_repr = module.widgetRepresentation()
        except Exception:
            widget_repr = None
        if widget_repr:
            candidates.append(widget_repr)
            if hasattr(widget_repr, "self"):
                try:
                    candidates.append(widget_repr.self())
                except Exception:
                    pass

    for candidate in candidates:
        if candidate is not None and hasattr(candidate, "setFull3DSlicerInterfaceVisible"):
            return candidate
    return None


def apply_simplified_viewer_ui() -> bool:
    """Switch into Simplified Viewer UI. Returns True if full widget mode worked."""
    hide_full_slicer_chrome()
    ensure_simplified_viewer_module_path()

    has_userstatistics = module_is_registered("UserStatistics")
    has_simplified = module_is_registered("SimplifiedViewer")
    if not has_simplified:
        try:
            factory = slicer.app.moduleManager().factoryManager()
            if hasattr(factory, "loadModules"):
                factory.loadModules()
            slicer.app.processEvents()
        except Exception:
            pass
        has_simplified = module_is_registered("SimplifiedViewer")

    if not has_simplified:
        sample = []
        try:
            names = list(slicer.app.moduleManager().modulesNames())
            sample = [n for n in names if "simpl" in n.lower() or "userstat" in n.lower()][:12]
        except Exception:
            pass
        log(
            "[slicer_session] SimplifiedViewer module is not registered; "
            f"userstatistics={'yes' if has_userstatistics else 'no'}; "
            f"sample={sample or 'none'}; "
            "chrome-only simplified mode active"
        )
        return False

    slicer.util.selectModule("SimplifiedViewer")
    slicer.app.processEvents()

    widget = find_simplified_viewer_widget()
    if widget is None:
        slicer.app.processEvents()
        widget = find_simplified_viewer_widget()

    if widget is not None:
        # Enable developer UI before collapsing chrome so the Settings gear is present.
        enable_simplified_viewer_developer_ui(widget)
        widget.setFull3DSlicerInterfaceVisible(False)
        return True

    log(
        "[slicer_session] SimplifiedViewer registered but widget API is unavailable; "
        "chrome-only simplified mode remains active"
    )
    return False


def restore_full_slicer_ui() -> None:
    """Restore standard Slicer chrome when Simplified Viewer is turned off."""
    try:
        from qt import QSettings
        settings = QSettings()
        settings.setValue("SimplifiedViewer/FullInterfaceVisible", True)
    except Exception:
        pass

    widget = find_simplified_viewer_widget()
    if widget is not None:
        try:
            widget.setFull3DSlicerInterfaceVisible(True)
        except Exception:
            pass

    slicer.util.setToolbarsVisible(True)
    slicer.util.setMenuBarsVisible(True)
    slicer.util.setApplicationLogoVisible(True)
    slicer.util.setModuleHelpSectionVisible(True)
    slicer.util.setModulePanelTitleVisible(True)
    slicer.util.setDataProbeVisible(True)
    slicer.util.setStatusBarVisible(True)
    try:
        slicer.util.setModulePanelVisible(True)
    except Exception:
        pass

    try:
        if module_is_registered("Volumes"):
            slicer.util.selectModule("Volumes")
        elif module_is_registered("Welcome"):
            slicer.util.selectModule("Welcome")
    except Exception:
        pass
    slicer.app.processEvents()


def maybe_apply_simplified_viewer(use_simplified_viewer: bool, *, force: bool = False) -> None:
    global _viewer_mode_simplified
    try:
        if use_simplified_viewer:
            # Re-apply when forced (e.g. developer "show full interface" recovery),
            # or when we are not already in simplified chrome.
            if force or _viewer_mode_simplified is not True:
                apply_simplified_viewer_ui()
            _viewer_mode_simplified = True
            return
        if _viewer_mode_simplified is False and not force:
            return
        restore_full_slicer_ui()
        _viewer_mode_simplified = False
    except Exception as exc:
        mode = "SimplifiedViewer" if use_simplified_viewer else "Full Slicer"
        log(f"[slicer_session] Could not apply {mode} UI: {exc}")
        log(traceback.format_exc())


def load_succeeded(
    ok: bool,
    path: str,
    nodes_before: int,
    nodes_after: int,
    data_before: int,
    data_after: int,
) -> bool:
    if not ok:
        return False
    lower = path.lower()
    if lower.endswith(".mrb"):
        return nodes_after > 15 or data_after >= 1
    return data_after > 0 and (data_after > data_before or data_after >= 1)


def is_permanent_load_error(message: str) -> bool:
    text = str(message or "")
    return any(marker in text for marker in PERMANENT_LOAD_MARKERS)


def strip_unsupported_mrml_nodes(mrml_text: str) -> tuple[str, list[str]]:
    removed: list[str] = []
    cleaned = mrml_text
    for tag in STRIP_MRML_TAGS:
        pattern = re.compile(
            rf"<{tag}\b[^>]*/>|<{tag}\b[^>]*>.*?</{tag}>",
            re.IGNORECASE | re.DOTALL,
        )
        cleaned, count = pattern.subn("", cleaned)
        if count:
            removed.append(f"{tag}x{count}")
    return cleaned, removed


def build_cleaned_mrb(path: str) -> str | None:
    """Copy MRB with unsupported optional view nodes removed from the MRML XML."""
    try:
        tmp_dir = tempfile.mkdtemp(prefix="slicer-mrb-")
        cleaned_path = os.path.join(tmp_dir, os.path.basename(path))
        with zipfile.ZipFile(path, "r") as src_zip:
            with zipfile.ZipFile(cleaned_path, "w", compression=zipfile.ZIP_DEFLATED) as dst_zip:
                stripped_any = False
                for info in src_zip.infolist():
                    data = src_zip.read(info.filename)
                    lower = info.filename.lower()
                    if lower.endswith(".mrml"):
                        text = data.decode("utf-8", errors="replace")
                        cleaned, removed = strip_unsupported_mrml_nodes(text)
                        if removed:
                            stripped_any = True
                            log(f"[slicer_session] Stripped unsupported MRML nodes: {', '.join(removed)}")
                            data = cleaned.encode("utf-8")
                    dst_zip.writestr(info, data)
        if not stripped_any:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return None
        return cleaned_path
    except Exception as exc:
        log(f"[slicer_session] Could not build cleaned MRB: {exc}")
        return None


def write_load_result(success: bool, payload: dict | None = None, error: str = "") -> None:
    try:
        with open(LOAD_RESULT_FILE, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "success": success is True,
                "fileId": payload.get("fileId") if payload else None,
                "path": (payload or {}).get("containerPath"),
                "error": error or None,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }))
    except OSError as exc:
        log(f"[slicer_session] Could not write load result: {exc}")


def persist_scene_loaded(payload: dict) -> None:
    """Mark scene loaded only after a confirmed Slicer load (for warm reopen skip)."""
    body = json.dumps({
        "fileId": payload.get("fileId"),
        "fileName": payload.get("fileName") or payload.get("stagedName"),
        "useSimplifiedViewer": payload.get("useSimplifiedViewer") is True,
        "sceneLoaded": True,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    # Prefer a slicer-owned marker. Backend often creates .last-loaded.json as root,
    # which this process cannot overwrite (EACCES) on Docker Desktop binds.
    for target in (SCENE_LOADED_FILE, LAST_LOADED_FILE):
        try:
            if target == LAST_LOADED_FILE:
                try:
                    os.remove(target)
                except FileNotFoundError:
                    pass
                except OSError:
                    # Keep going — SCENE_LOADED_FILE is the reliable path.
                    continue
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(body)
            try:
                os.chmod(target, 0o666)
            except OSError:
                pass
            return
        except OSError as exc:
            log(f"[slicer_session] Could not persist {target}: {exc}")
    log("[slicer_session] Could not persist last-loaded marker")


def load_mrb_scene(path: str) -> bool:
    global _last_load_error
    _last_load_error = ""
    cleaned_path = None
    try:
        log(f"[slicer_session] loadScene: {os.path.basename(path)}")
        slicer.mrmlScene.Clear(0)
        slicer.app.processEvents()
        try:
            ok = bool(slicer.util.loadScene(path))
        except Exception as exc:
            _last_load_error = str(exc)
            log(f"[slicer_session] loadScene exception: {exc}")
            ok = False

        if ok:
            return True

        if is_permanent_load_error(_last_load_error) or not _last_load_error:
            cleaned_path = build_cleaned_mrb(path)
            if cleaned_path:
                log(f"[slicer_session] Retry loadScene with cleaned MRB: {cleaned_path}")
                slicer.mrmlScene.Clear(0)
                slicer.app.processEvents()
                try:
                    ok = bool(slicer.util.loadScene(cleaned_path))
                    if ok:
                        _last_load_error = ""
                        return True
                except Exception as exc:
                    _last_load_error = str(exc)
                    log(f"[slicer_session] Cleaned MRB load exception: {exc}")

        log("[slicer_session] loadScene failed, trying ioManager.loadFile")
        try:
            ok = bool(slicer.app.ioManager().loadFile(path, True))
            if ok:
                _last_load_error = ""
            return ok
        except Exception as exc:
            _last_load_error = str(exc)
            log(f"[slicer_session] ioManager exception: {exc}")
            return False
    finally:
        if cleaned_path:
            try:
                shutil.rmtree(os.path.dirname(cleaned_path), ignore_errors=True)
            except Exception:
                pass


def load_staged_file(path: str, defer_view_refresh: bool = False) -> bool:
    global _last_load_error
    if not os.path.isfile(path):
        log(f"[slicer_session] Staged file missing: {path}")
        _last_load_error = "staged file missing"
        return False

    nodes_before = slicer.mrmlScene.GetNumberOfNodes()
    data_before = count_data_nodes()
    lower = path.lower()
    ok = False

    try:
        if lower.endswith(".mrb"):
            ok = load_mrb_scene(path)
        else:
            log(f"[slicer_session] Add Data via ioManager: {path}")
            ok = bool(slicer.app.ioManager().loadFile(path, False))
            if not ok:
                log("[slicer_session] ioManager failed, trying loadVolume")
                ok = slicer.util.loadVolume(path) is not None
    except Exception as exc:
        _last_load_error = str(exc)
        log(f"[slicer_session] Load exception: {exc}")
        log(traceback.format_exc())
        return False

    slicer.app.processEvents()

    nodes_after = slicer.mrmlScene.GetNumberOfNodes()
    data_after = count_data_nodes()
    layout_id = -1
    layout_manager = slicer.app.layoutManager()
    if layout_manager:
        layout_id = layout_manager.layoutLogic().GetLayoutNode().GetViewArrangement()

    loaded = load_succeeded(ok, path, nodes_before, nodes_after, data_before, data_after)
    log(
        f"[slicer_session] ok={ok} loaded={loaded} nodes={nodes_before}->{nodes_after} "
        f"data={data_before}->{data_after} layout={layout_id}"
    )

    if loaded and not defer_view_refresh:
        schedule_view_refresh()
    return loaded


def clear_request() -> None:
    try:
        os.remove(REQUEST_FILE)
    except OSError as exc:
        log(f"[slicer_session] Could not remove request file: {exc}")


def rewrite_open_request(payload: dict) -> None:
    """Put a claimed request back on disk for a limited retry."""
    try:
        tmp = f"{REQUEST_FILE}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2))
        os.replace(tmp, REQUEST_FILE)
        try:
            os.chmod(REQUEST_FILE, 0o666)
        except OSError:
            pass
        log("[slicer_session] Re-queued open request for retry")
    except OSError as exc:
        log(f"[slicer_session] Could not re-queue open request: {exc}")


def set_busy(message: str = "loading") -> None:
    try:
        with open(BUSY_FILE, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "busy": True,
                "message": message,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }))
    except OSError as exc:
        log(f"[slicer_session] Could not write busy file: {exc}")


def clear_busy() -> None:
    try:
        os.remove(BUSY_FILE)
    except OSError:
        pass


def clear_ready() -> None:
    try:
        os.remove(READY_FILE)
    except OSError:
        pass


def mark_ready() -> None:
    global _ready_announced
    try:
        with open(READY_FILE, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "ready": True,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }))
        if not _ready_announced:
            log("[slicer_session] Ready for open requests")
            _ready_announced = True
    except OSError as exc:
        log(f"[slicer_session] Could not write ready file: {exc}")


def maintain_ready_marker() -> None:
    """Publish readiness only once the main window UI can accept loads."""
    if ui_ready():
        mark_ready()
        QTimer.singleShot(2000, maintain_ready_marker)
    else:
        QTimer.singleShot(500, maintain_ready_marker)


def poll_open_requests() -> None:
    global _busy, _last_completed_key, _ui_wait_logged, _load_overlay, _overlay_raise_timer
    if _busy:
        return

    if not os.path.isfile(REQUEST_FILE):
        _ui_wait_logged = False
        return

    if not ui_ready():
        if not _ui_wait_logged:
            log("[slicer_session] UI not ready, deferring open request")
            _ui_wait_logged = True
        return
    _ui_wait_logged = False

    # Claim (delete) before any Qt/Slicer work so re-entrant polls cannot loop.
    payload, key = claim_open_request()
    if not payload:
        return

    path = payload["containerPath"]
    use_simplified_viewer = payload.get("useSimplifiedViewer") is True
    requested_at = (payload.get("requestedAt") or "").strip()
    dedupe_key = key or requested_at or path

    _busy = True
    overlay_shown = False
    keep_busy_for_overlay = False
    set_busy("opening")
    try:
        log(f"[slicer_session] Open request: {os.path.basename(path)}")

        skip_load = payload.get("skipLoad") is True

        # Mode-only warm reopen: stay silent — no black overlay / view hide flash.
        if skip_load:
            try:
                node_count = int(slicer.mrmlScene.GetNumberOfNodes())
            except Exception:
                node_count = 0
            try:
                data_count = int(slicer.mrmlScene.GetNumberOfNodesByClass("vtkMRMLVolumeNode")) + int(
                    slicer.mrmlScene.GetNumberOfNodesByClass("vtkMRMLModelNode")
                )
            except Exception:
                data_count = 0
            scene_present = node_count > 15 or data_count >= 1
            if scene_present:
                maybe_apply_simplified_viewer(use_simplified_viewer)
                try:
                    persist_scene_loaded(payload)
                except Exception as exc:
                    log(f"[slicer_session] persist_scene_loaded failed: {exc}")
                try:
                    write_load_result(True, payload)
                except Exception as exc:
                    log(f"[slicer_session] write_load_result failed: {exc}")
                log(
                    f"[slicer_session] Mode-only apply done "
                    f"(simplified={use_simplified_viewer}, skipLoad, silent)"
                )
                clear_busy()
                return
            log(
                f"[slicer_session] skipLoad requested but scene looks empty "
                f"(nodes={node_count}, data≈{data_count}) — loading file"
            )

        show_load_overlay(
            "Opening simplified viewer…" if use_simplified_viewer else "Opening Full Slicer…"
        )
        overlay_shown = True

        # Apply chrome mode once per transition (skipping repeated Full restores saves time).
        ensure_slicerheart_layouts()
        maybe_apply_simplified_viewer(use_simplified_viewer)

        if not wait_file_readable(path):
            log(f"[slicer_session] Timed out waiting for {path}")
            attempts = _failed_attempts.get(dedupe_key, 0) + 1
            _failed_attempts[dedupe_key] = attempts
            if attempts < MAX_LOAD_ATTEMPTS:
                rewrite_open_request(payload)
            else:
                _failed_attempts.pop(dedupe_key, None)
            return

        # Always defer view refresh until after we mark complete — refresh calls
        # processEvents and must not run while a request could be re-claimed.
        set_busy("loading")
        try:
            loaded = load_staged_file(path, defer_view_refresh=True)
        except Exception as exc:
            log(f"[slicer_session] load_staged_file crashed: {exc}")
            log(traceback.format_exc())
            loaded = False

        if loaded:
            _last_completed_key = key
            _failed_attempts.pop(dedupe_key, None)
            try:
                persist_scene_loaded(payload)
            except Exception as exc:
                log(f"[slicer_session] persist_scene_loaded failed: {exc}")
            try:
                write_load_result(True, payload)
            except Exception as exc:
                log(f"[slicer_session] write_load_result failed: {exc}")
            log(f"[slicer_session] Done: {os.path.basename(path)}")

            try:
                ensure_slicerheart_layouts()
                if use_simplified_viewer:
                    maybe_apply_simplified_viewer(True, force=True)
                ensure_scene_layout_ready()
                schedule_view_refresh()
                schedule_hide_load_overlay(_OVERLAY_HOLD_MS)
                overlay_shown = False
                keep_busy_for_overlay = True
                QTimer.singleShot(_OVERLAY_HOLD_MS + 50, clear_busy)
            except Exception as exc:
                log(f"[slicer_session] Post-load UI adjust failed (scene kept): {exc}")
                log(traceback.format_exc())
                try:
                    schedule_view_refresh()
                except Exception:
                    pass
                try:
                    hide_load_overlay()
                except Exception:
                    pass
                overlay_shown = False
                clear_busy()

            return

        attempts = _failed_attempts.get(dedupe_key, 0) + 1
        _failed_attempts[dedupe_key] = attempts
        permanent = is_permanent_load_error(_last_load_error)
        log(
            f"[slicer_session] Load failed (attempt {attempts}/{MAX_LOAD_ATTEMPTS})"
            + (" [permanent]" if permanent else "")
            + f": {path}"
        )
        if permanent or attempts >= MAX_LOAD_ATTEMPTS:
            try:
                write_load_result(False, payload, error=_last_load_error or "load failed")
            except Exception:
                pass
            _failed_attempts.pop(dedupe_key, None)
            log(f"[slicer_session] Giving up on open request: {path}")
        else:
            rewrite_open_request(payload)
    except Exception as exc:
        log(f"[slicer_session] poll_open_requests crashed: {exc}")
        log(traceback.format_exc())
    finally:
        if overlay_shown:
            # Tear down overlay without processEvents (avoids poller re-entry).
            try:
                if _overlay_raise_timer is not None:
                    _overlay_raise_timer.stop()
                    _overlay_raise_timer.deleteLater()
                    _overlay_raise_timer = None
                if _load_overlay is not None:
                    _load_overlay.hide()
                    _load_overlay.deleteLater()
                    _load_overlay = None
            except Exception:
                _load_overlay = None
                _overlay_raise_timer = None
        if not keep_busy_for_overlay:
            clear_busy()
        _busy = False


def start_polling() -> None:
    global _poll_timer
    enable_developer_mode()
    clear_busy()
    clear_ready()
    try:
        ensure_slicerheart_layouts()
    except Exception as exc:
        log(f"[slicer_session] SlicerHeart layout registration failed: {exc}")
    _poll_timer = QTimer()
    _poll_timer.timeout.connect(poll_open_requests)
    _poll_timer.start(POLL_MS)
    QTimer.singleShot(500, maintain_ready_marker)
    QTimer.singleShot(500, poll_open_requests)


start_polling()
