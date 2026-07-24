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
_hidden_view_widgets: list = []
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


def refresh_slice_views() -> None:
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return

    app_logic = slicer.app.applicationLogic()
    selection = app_logic.GetSelectionNode()
    volume_id = selection.GetActiveVolumeID() or selection.GetReferenceActiveVolumeID()
    volume = slicer.mrmlScene.GetNodeByID(volume_id) if volume_id else None

    if volume is None:
        for class_name in ("vtkMRMLScalarVolumeNode", "vtkMRMLLabelMapVolumeNode"):
            nodes = iter_nodes(class_name)
            if nodes:
                volume = nodes[0]
                volume_id = volume.GetID()
                break

    if volume_id and volume:
        selection.SetActiveVolumeID(volume_id)
        selection.SetReferenceActiveVolumeID(volume_id)
        app_logic.PropagateVolumeSelection(0)
        slicer.util.setSliceViewerLayers(background=volume, fit=True)

    if hasattr(app_logic, "FitSliceToAll"):
        app_logic.FitSliceToAll(True, False)

    slicer.app.processEvents()


def volume_from_vr_display_node(display_node):
    if hasattr(display_node, "GetDisplayableNode"):
        return display_node.GetDisplayableNode()
    volume_id = display_node.GetDisplayableNodeID() if hasattr(display_node, "GetDisplayableNodeID") else ""
    return slicer.mrmlScene.GetNodeByID(volume_id) if volume_id else None


def refresh_three_d_views() -> None:
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
        visible = view_node.GetVisibility()
        view_node.SetVisibility(False)
        view_node.SetVisibility(visible)
        view_node.Modified()

    vol_ren_logic = getattr(getattr(slicer.modules, "volumerendering", None), "logic", lambda: None)()
    vr_count = 0
    if vol_ren_logic:
        for display_node in iter_nodes("vtkMRMLVolumeRenderingDisplayNode"):
            vr_count += 1
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
        view.resetFocalPoint()
        view.resetCamera()
        if hasattr(view, "resetCameraClippingRange"):
            view.resetCameraClippingRange()
        view.forceRender()

    if hasattr(slicer.util, "forceRenderAllViews"):
        slicer.util.forceRenderAllViews()

    slicer.app.processEvents()
    log(
        f"[slicer_session] refreshed {layout_manager.threeDViewCount} 3D view(s), "
        f"{vr_count} volume-rendering display node(s)"
    )


def refresh_all_views() -> None:
    refresh_slice_views()
    refresh_three_d_views()


def schedule_view_refresh() -> None:
    refresh_all_views()
    QTimer.singleShot(500, refresh_all_views)
    QTimer.singleShot(1500, refresh_all_views)
    QTimer.singleShot(3000, refresh_three_d_views)
    QTimer.singleShot(5000, refresh_three_d_views)
    QTimer.singleShot(1000, run_window_size_sync)
    QTimer.singleShot(3000, run_window_size_sync)


def ensure_simplified_viewer_module_path() -> None:
    """Ensure SimplifiedViewer search path is registered with the module factory."""
    candidates = [
        os.environ.get("SLICER_SIMPLIFIED_VIEWER_PATH", "").strip(),
        "/opt/slicer-modules/SimplifiedViewer",
        "/home/slicer/data/SimplifiedViewer",
    ]
    module_dir = next(
        (path for path in candidates if path and os.path.isfile(os.path.join(path, "SimplifiedViewer.py"))),
        "",
    )
    if not module_dir:
        log("[slicer_session] SimplifiedViewer.py not found on known module paths")
        return

    # Module factory searchPaths must include the folder that contains SimplifiedViewer.py.
    log(f"[slicer_session] Ensuring module search path: {module_dir}")

    try:
        from qt import QSettings
        settings = QSettings()
        existing = settings.value("Modules/AdditionalPaths") or []
        if isinstance(existing, str):
            existing = [existing] if existing else []
        paths = [str(path) for path in existing]
        if module_dir not in paths:
            paths.append(module_dir)
            settings.setValue("Modules/AdditionalPaths", paths)
            log(f"[slicer_session] Added Modules/AdditionalPaths entry: {module_dir}")
    except Exception as exc:
        log(f"[slicer_session] Could not update Modules/AdditionalPaths: {exc}")

    try:
        factory = slicer.app.moduleManager().factoryManager()
        paths = list(getattr(factory, "searchPaths", []) or [])
        if module_dir not in paths:
            paths.append(module_dir)
            factory.searchPaths = paths
        if hasattr(factory, "loadModules"):
            factory.loadModules()
        slicer.app.processEvents()
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


def hide_full_slicer_chrome() -> None:
    """Hide standard Slicer chrome even if SimplifiedViewer widget is unavailable."""
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


def hide_view_widgets() -> None:
    """Temporarily hide slice/3D view widgets so OpenGL cannot flash under splash."""
    global _hidden_view_widgets
    restore_view_widgets()
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    widgets = []
    try:
        for name in ("Red", "Yellow", "Green"):
            widget = layout_manager.sliceWidget(name)
            if widget is not None:
                widgets.append(widget)
        for index in range(getattr(layout_manager, "threeDViewCount", 0) or 0):
            widget = layout_manager.threeDWidget(index)
            if widget is not None:
                widgets.append(widget)
    except Exception as exc:
        log(f"[slicer_session] Could not collect view widgets: {exc}")
        return

    for widget in widgets:
        try:
            if widget.isVisible():
                widget.hide()
                _hidden_view_widgets.append(widget)
        except Exception:
            pass
    if _hidden_view_widgets:
        log(f"[slicer_session] Hid {len(_hidden_view_widgets)} view widget(s) during load")


def restore_view_widgets() -> None:
    global _hidden_view_widgets
    restored = set()
    for widget in _hidden_view_widgets:
        try:
            widget.show()
            restored.add(id(widget))
        except Exception:
            pass
    _hidden_view_widgets = []

    # Scene load can recreate view widgets; show current layout widgets too.
    layout_manager = slicer.app.layoutManager()
    if not layout_manager:
        return
    try:
        for name in ("Red", "Yellow", "Green"):
            widget = layout_manager.sliceWidget(name)
            if widget is not None and id(widget) not in restored:
                widget.show()
        for index in range(getattr(layout_manager, "threeDViewCount", 0) or 0):
            widget = layout_manager.threeDWidget(index)
            if widget is not None and id(widget) not in restored:
                widget.show()
    except Exception:
        pass


def show_load_overlay(message: str = "Loading viewer…") -> None:
    """Show a splash over the main window and hide GL views during load."""
    global _load_overlay, _overlay_raise_timer
    hide_load_overlay()
    hide_view_widgets()
    try:
        from qt import QWidget, QLabel, QVBoxLayout, Qt

        main_window = slicer.util.mainWindow()
        if not main_window:
            return

        # Parent to main window so noVNC always shows it; GL views are hidden above.
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
        label.setAlignment(Qt.AlignCenter)
        label.setStyleSheet(
            "color: #e8e8ef; font-size: 20px; font-weight: 600; background: transparent;"
        )
        layout.addWidget(label)
        hint = QLabel("Please wait while the scene loads.")
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
        log("[slicer_session] Load overlay shown")
    except Exception as exc:
        log(f"[slicer_session] Could not show load overlay: {exc}")
        _load_overlay = None


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
            log("[slicer_session] Load overlay hidden")
    except Exception as exc:
        log(f"[slicer_session] Could not hide load overlay: {exc}")
        _load_overlay = None
        _overlay_raise_timer = None
    restore_view_widgets()


def schedule_hide_load_overlay(delay_ms: int = _OVERLAY_HOLD_MS) -> None:
    """Keep splash up through initial view refreshes before revealing."""
    QTimer.singleShot(max(0, int(delay_ms)), hide_load_overlay)


def find_simplified_viewer_widget():
    candidates = []
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
        widget.setFull3DSlicerInterfaceVisible(False)
        log("[slicer_session] SimplifiedViewer enabled")
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
    log("[slicer_session] Full Slicer UI restored")


def maybe_apply_simplified_viewer(use_simplified_viewer: bool) -> None:
    global _viewer_mode_simplified
    try:
        if _viewer_mode_simplified is use_simplified_viewer:
            return
        if use_simplified_viewer:
            apply_simplified_viewer_ui()
        else:
            restore_full_slicer_ui()
        _viewer_mode_simplified = use_simplified_viewer
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
    try:
        with open(LAST_LOADED_FILE, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "fileId": payload.get("fileId"),
                "fileName": payload.get("fileName") or payload.get("stagedName"),
                "useSimplifiedViewer": payload.get("useSimplifiedViewer") is True,
                "sceneLoaded": True,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }))
    except OSError as exc:
        log(f"[slicer_session] Could not persist last-loaded marker: {exc}")


def load_mrb_scene(path: str) -> bool:
    global _last_load_error
    _last_load_error = ""
    cleaned_path = None
    try:
        log(f"[slicer_session] loadScene: {path}")
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
        log(
            f"[slicer_session] Open request: {path} "
            f"(fileId={payload.get('fileId', '')}, requestedAt={requested_at}, "
            f"useSimplifiedViewer={use_simplified_viewer})"
        )

        show_load_overlay(
            "Opening simplified viewer…" if use_simplified_viewer else "Opening Full Slicer…"
        )
        overlay_shown = True

        # Apply chrome mode once per transition (skipping repeated Full restores saves time).
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
            log(f"[slicer_session] Done: {path}")

            try:
                if use_simplified_viewer:
                    maybe_apply_simplified_viewer(True)
                schedule_view_refresh()
                schedule_hide_load_overlay(_OVERLAY_HOLD_MS)
                overlay_shown = False
                keep_busy_for_overlay = True
                QTimer.singleShot(_OVERLAY_HOLD_MS + 50, clear_busy)
            except Exception as exc:
                log(f"[slicer_session] Post-load UI adjust failed (scene kept): {exc}")

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
            # Do not call hide_load_overlay() here — it processEvents() and can
            # re-enter the poller. Tear down splash without pumping the event loop.
            try:
                if _overlay_raise_timer is not None:
                    _overlay_raise_timer.stop()
                    _overlay_raise_timer.deleteLater()
                    _overlay_raise_timer = None
                if _load_overlay is not None:
                    _load_overlay.hide()
                    _load_overlay.deleteLater()
                    _load_overlay = None
                    log("[slicer_session] Load overlay hidden")
            except Exception:
                _load_overlay = None
                _overlay_raise_timer = None
            restore_view_widgets()
        if not keep_busy_for_overlay:
            clear_busy()
        _busy = False


def start_polling() -> None:
    global _poll_timer
    clear_busy()
    clear_ready()
    _poll_timer = QTimer()
    _poll_timer.timeout.connect(poll_open_requests)
    _poll_timer.start(POLL_MS)
    log(f"[slicer_session] Polling {REQUEST_FILE} every {POLL_MS}ms")
    QTimer.singleShot(500, maintain_ready_marker)
    QTimer.singleShot(500, poll_open_requests)


start_polling()
