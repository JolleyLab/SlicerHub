"""Poll for staged open requests and load in the running Slicer process."""
from __future__ import annotations

import json
import os
import subprocess
import time
import traceback

import slicer
from qt import QTimer

REQUEST_FILE = "/home/slicer/data/.open-request.json"
LOG_FILE = "/home/slicer/data/slicer-session.log"
POLL_MS = 1000
MAX_LOAD_ATTEMPTS = 30
_busy = False
_failed_attempts: dict[str, int] = {}
_last_completed_key = ""
_ui_wait_logged = False
_poll_timer = None


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
    return f"{file_id}:{requested_at}:{path}"


def should_process_request(payload: dict) -> bool:
    global _last_completed_key
    key = request_key(payload)
    if key != _last_completed_key:
        return True
    if os.path.isfile(REQUEST_FILE):
        log(f"[slicer_session] Request file still present, retrying: {key}")
        return True
    return False


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


def load_staged_file(path: str) -> bool:
    if not os.path.isfile(path):
        log(f"[slicer_session] Staged file missing: {path}")
        return False

    nodes_before = slicer.mrmlScene.GetNumberOfNodes()
    data_before = count_data_nodes()
    lower = path.lower()

    try:
        if lower.endswith(".mrb"):
            log(f"[slicer_session] loadScene: {path}")
            slicer.mrmlScene.Clear(0)
            slicer.app.processEvents()
            ok = bool(slicer.util.loadScene(path))
            if not ok:
                log("[slicer_session] loadScene failed, trying ioManager.loadFile")
                ok = bool(slicer.app.ioManager().loadFile(path, True))
        else:
            log(f"[slicer_session] Add Data via ioManager: {path}")
            ok = bool(slicer.app.ioManager().loadFile(path, False))
            if not ok:
                log("[slicer_session] ioManager failed, trying loadVolume")
                ok = slicer.util.loadVolume(path) is not None
    except Exception as exc:
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

    if loaded:
        schedule_view_refresh()
    return loaded


def clear_request() -> None:
    try:
        os.remove(REQUEST_FILE)
    except OSError as exc:
        log(f"[slicer_session] Could not remove request file: {exc}")


def poll_open_requests() -> None:
    global _busy, _last_completed_key, _ui_wait_logged
    if _busy:
        return

    payload = read_request()
    if not payload:
        _ui_wait_logged = False
        return

    path = payload["containerPath"]
    requested_at = (payload.get("requestedAt") or "").strip()
    key = request_key(payload)
    if not should_process_request(payload):
        return

    if not ui_ready():
        if not _ui_wait_logged:
            log("[slicer_session] UI not ready, deferring open request")
            _ui_wait_logged = True
        return
    _ui_wait_logged = False

    dedupe_key = key or requested_at or path
    _busy = True
    try:
        log(
            f"[slicer_session] Open request: {path} "
            f"(fileId={payload.get('fileId', '')}, requestedAt={requested_at})"
        )
        slicer.mrmlScene.Clear(0)
        slicer.app.processEvents()
        if not wait_file_readable(path):
            log(f"[slicer_session] Timed out waiting for {path}")
            attempts = _failed_attempts.get(dedupe_key, 0) + 1
            _failed_attempts[dedupe_key] = attempts
            if attempts >= MAX_LOAD_ATTEMPTS:
                clear_request()
                _failed_attempts.pop(dedupe_key, None)
            return

        if load_staged_file(path):
            _last_completed_key = key
            _failed_attempts.pop(dedupe_key, None)
            clear_request()
            log(f"[slicer_session] Done: {path}")
            QTimer.singleShot(250, poll_open_requests)
            return

        attempts = _failed_attempts.get(dedupe_key, 0) + 1
        _failed_attempts[dedupe_key] = attempts
        log(f"[slicer_session] Load failed (attempt {attempts}/{MAX_LOAD_ATTEMPTS}): {path}")
        if attempts >= MAX_LOAD_ATTEMPTS:
            clear_request()
            _failed_attempts.pop(dedupe_key, None)
    finally:
        _busy = False


def start_polling() -> None:
    global _poll_timer
    _poll_timer = QTimer()
    _poll_timer.timeout.connect(poll_open_requests)
    _poll_timer.start(POLL_MS)
    log(f"[slicer_session] Polling {REQUEST_FILE} every {POLL_MS}ms")
    QTimer.singleShot(3000, poll_open_requests)


start_polling()
