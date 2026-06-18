"""
Custom Medical Viewer - extends trame-slicer with server-side file loading
Uses the official trame-slicer viewer UI with minimal modifications
"""

from __future__ import annotations

import argparse
import os
import json
from pathlib import Path
import threading
import time

from trame.app import get_server
from trame.app.testing import enable_testing
from trame.decorators import TrameApp

from trame_slicer.core import SlicerApp

# Import the official viewer components
try:
    from viewer_lib import MedicalViewerLogic, MedicalViewerUI
except ModuleNotFoundError:
    import sys
    sys.path.insert(0, '/app/trame-slicer/examples')
    from viewer_lib import MedicalViewerLogic, MedicalViewerUI


@TrameApp()
class CustomMedicalViewer:
    """
    Extends the official MedicalViewerApp with server-side file loading capability.
    All UI and logic from trame-slicer is preserved unchanged.
    """
    
    def __init__(self, server=None, input_file=None, view_state=None):
        self._server = get_server(server, client_type="vue3")
        self._slicer_app = SlicerApp()
        self._input_file = input_file
        self._view_state = view_state or None

        # Use the official viewer logic and UI
        self._logic = MedicalViewerLogic(self._server, self._slicer_app)
        self._ui = MedicalViewerUI(self._server, self._logic.layout_manager)
        self._logic.set_ui(self._ui)

        # Add server-side file loading method
        self._register_file_loading()
        self._start_save_request_watcher()
        self._start_view_state_request_watcher()
        self._start_apply_view_state_request_watcher()
        self._register_parent_activity_bridge()

    def _register_parent_activity_bridge(self) -> None:
        """Notify the parent frame when the user interacts with the viewer."""
        @self._server.controller.add("on_server_ready")
        def _add_activity_bridge(**_kwargs):
            from trame.widgets import html

            ui = self._server.ui
            if not hasattr(ui, "__enter__"):
                print("Parent activity bridge skipped: server.ui not ready")
                return

            with ui:
                html.Script(
                    """
                (function () {
                  function notify() {
                    try {
                      window.parent.postMessage({ type: 'slicer-viewer-activity' }, '*');
                    } catch (e) {}
                  }
                  var last = 0;
                  function throttled() {
                    var now = Date.now();
                    if (now - last < 5000) return;
                    last = now;
                    notify();
                  }
                  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (evt) {
                    window.addEventListener(evt, throttled, { passive: true });
                  });
                  notify();
                })();
                """
                )

    @property
    def server(self):
        return self._server

    def _register_file_loading(self):
        """Register a server-side file loading method"""
        @self._server.controller.add("load_server_file")
        def load_server_file(file_path):
            """Load a file from the server filesystem (not client upload)"""
            if not os.path.exists(file_path):
                print(f"File not found: {file_path}")
                return
            
            print(f"Loading server file: {file_path}")
            
            # Clear scene first (same as official flow does in _load_volume_files)
            self._slicer_app.scene.Clear()
            
            # Use the official load volume logic's internal methods
            # This ensures all the proper signals and setup happen
            load_logic = self._logic._load_files_logic
            
            # Load based on file type
            if file_path.lower().endswith('.mrb'):
                print("Loading MRB scene...")
                load_logic._on_load_scene(file_path)
                print("MRB scene loaded")
            else:
                print("Loading volume file...")
                # For volume files, load directly and use _show_largest_volume
                # This matches the UI button flow
                volumes = self._slicer_app.io_manager.load_volumes([file_path])
                print(f"Loaded {len(volumes)} volumes")
                if volumes:
                    print("Calling _show_largest_volume...")
                    load_logic._show_largest_volume(volumes)
                    print("_show_largest_volume completed")
            
            # Force state update to client
            self._server.state.flush()
            print("File loading completed, state flushed")

        @self._server.controller.add("save_current_scene")
        def save_current_scene():
            self._save_scene_to_disk()

    def _save_scene_to_disk(self) -> bool:
        """Save active scene to a stable path to avoid save-file clutter."""
        output_dir = Path("/data")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "last-saved-scene.mrb"
        return self._save_scene_to_path(output_path)

    def _save_scene_to_path(self, output_path: Path) -> bool:
        """Persist the live scene directly to MRB at a target path."""
        success = False
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # Prefer the viewer's native save workflow when available, since it can
            # apply viewer-specific state sync before writing.
            load_logic = getattr(self._logic, "_load_files_logic", None)
            if load_logic and hasattr(load_logic, "_on_save_scene"):
                load_logic._on_save_scene(str(output_path))
                success = output_path.exists() and output_path.stat().st_size > 0
            else:
                # Fallback: direct MRB write using atomic replace.
                temp_output_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
                scene = self._slicer_app.scene
                scene.SetURL(str(temp_output_path))
                scene.SetRootDirectory(str(temp_output_path.parent))
                success = bool(scene.WriteToMRB(str(temp_output_path)))
                if success:
                    temp_size = temp_output_path.stat().st_size if temp_output_path.exists() else 0
                    if temp_size > 0:
                        temp_output_path.replace(output_path)
                    else:
                        success = False
            success = success and output_path.exists() and output_path.stat().st_size > 0
        except Exception as err:
            print(f"Save exception for {output_path}: {err}")
            success = False

        if success:
            print(f"Scene saved successfully: {output_path} ({output_path.stat().st_size} bytes)")
        else:
            size = output_path.stat().st_size if output_path.exists() else 0
            print(f"Failed to save scene: {output_path} (size={size})")
        return success

    def _start_save_request_watcher(self) -> None:
        """Watch for JSON save requests created by the session manager in /tmp."""
        request_pattern = "/tmp/trame-save-request-*.json"

        def _watch():
            while True:
                try:
                    import glob
                    request_files = glob.glob(request_pattern)
                    for request_file in request_files:
                        req_path = Path(request_file)
                        payload = {}
                        try:
                            payload = json.loads(req_path.read_text())
                        except Exception:
                            payload = {}
                        req_path.unlink(missing_ok=True)

                        request_id = str(payload.get("request_id", "unknown"))
                        requested_path = payload.get("output_path")

                        success = False
                        output_path = None
                        error_message = None
                        try:
                            if requested_path:
                                output_path = Path(requested_path)
                                success = self._save_scene_to_path(output_path)
                            else:
                                success = self._save_scene_to_disk()
                                output_path = Path("/data/last-saved-scene.mrb")
                        except Exception as err:
                            error_message = str(err)
                            success = False

                        result_payload = {
                            "request_id": request_id,
                            "success": bool(success),
                            "output_path": str(output_path) if output_path else "",
                            "size": output_path.stat().st_size if output_path and output_path.exists() else 0,
                            "error": error_message or "",
                        }
                        result_path = Path(f"/tmp/trame-save-result-{request_id}.json")
                        result_path.write_text(json.dumps(result_payload))
                except Exception as err:
                    print(f"Save request watcher error: {err}")
                time.sleep(0.5)

        thread = threading.Thread(target=_watch, daemon=True)
        thread.start()

    def load_input_file(self):
        """Load the input file specified at startup"""
        if self._input_file and os.path.exists(self._input_file):
            self._server.controller.load_server_file(self._input_file)
        self._start_deferred_view_state_apply()

    def _start_deferred_view_state_apply(self):
        """Apply share view-state asynchronously so startup is not blocked."""
        if not self._view_state:
            return

        def _runner():
            try:
                # Give the MRB scene a brief moment to finish late initialization hooks.
                time.sleep(1.0)
                result = self._apply_view_state_thread_safe(self._view_state, wait_timeout_seconds=75.0)
                print(f"Deferred view-state apply result: {result}")
            except Exception as err:
                print(f"Deferred view-state apply error: {err}")

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()

    def _apply_view_state_thread_safe(self, view_state, wait_timeout_seconds=75.0):
        """
        Execute view-state replay on the Slicer main thread when possible.
        Accessing MRML scene from worker threads can return incomplete/empty data.
        """
        if not view_state:
            return {"success": False, "error": "No view state payload"}

        attempts = 80
        delay_seconds = 0.5
        per_attempt_wait_seconds = max(1.0, min(wait_timeout_seconds, 5.0))
        last_result = {"success": False, "error": "not_executed"}

        for attempt_index in range(attempts):
            result_holder = {"result": {"success": False, "error": "not_executed"}}
            done = threading.Event()

            def _run():
                try:
                    result_holder["result"] = self.apply_view_state_payload(view_state)
                except Exception as err:
                    result_holder["result"] = {"success": False, "error": str(err)}
                finally:
                    done.set()

            try:
                import qt
                qt.QTimer.singleShot(0, _run)
            except Exception:
                _run()

            finished = done.wait(per_attempt_wait_seconds)
            if not finished:
                last_result = {"success": False, "error": "main_thread_apply_timeout"}
            else:
                last_result = result_holder.get("result") or {"success": False, "error": "empty_apply_result"}
                if last_result.get("success"):
                    seg = last_result.get("segmentation")
                    if isinstance(seg, dict):
                        seg["attempts"] = attempt_index + 1
                    return last_result

            time.sleep(delay_seconds)

        seg = last_result.get("segmentation")
        if isinstance(seg, dict) and not seg.get("attempts"):
            seg["attempts"] = attempts
        return last_result

    def apply_view_state(self):
        """Best-effort replay of a captured view state snapshot."""
        state = self._view_state
        return self.apply_view_state_payload(state).get("success", False)

    def apply_view_state_payload(self, state):
        """Apply an arbitrary view-state payload and return whether replay succeeded."""
        if not state:
            return {"success": False, "error": "No view state payload"}
        try:
            requested_layout = state.get("layout")
            if requested_layout is not None:
                layout_manager = getattr(self._logic, "layout_manager", None)
                setter = getattr(layout_manager, "set_layout", None)
                if callable(setter):
                    setter(requested_layout)
            # Single-pass apply; retries are orchestrated by _apply_view_state_thread_safe
            # to avoid blocking the Slicer main thread for long windows.
            seg_apply = self._apply_segmentation_state(state.get("segmentation"))
            return {
                "success": bool(seg_apply.get("success")),
                "segmentation": seg_apply,
            }
            # Keep this lightweight for first pass; additional state can be applied here later.
        except Exception as err:
            print(f"Unable to apply view state: {err}")
            return {"success": False, "error": str(err)}

    def _capture_view_state(self):
        """Capture a minimal but stable snapshot of current viewer context."""
        snapshot = {
            "captureMode": "basic",
            "capturedAt": int(time.time()),
            "inputFile": self._input_file or "",
        }
        try:
            layout_manager = getattr(self._logic, "layout_manager", None)
            getter = getattr(layout_manager, "layout", None)
            if getter is not None:
                snapshot["layout"] = getter
        except Exception:
            pass
        snapshot["segmentation"] = self._capture_segmentation_state()
        return snapshot

    def _capture_segmentation_state(self):
        """Capture active segmentation context (best effort, name-oriented)."""
        result = {
            "activeSegmentationNodeName": "",
            "selectedSegmentId": "",
            "selectedSegmentName": "",
            "visibleSegmentationNodeNames": [],
            "visibleSegmentNames": [],
            "captureSource": "",
        }
        try:
            import slicer
            seg_editor = getattr(self._slicer_app, "segmentation_editor", None)

            # Prefer trame-slicer segmentation editor state, which is what the UI panel binds to.
            if seg_editor and getattr(seg_editor, "active_segmentation_node", None):
                active_node = seg_editor.active_segmentation_node
                result["activeSegmentationNodeName"] = active_node.GetName() or ""
                selected_segment_id = seg_editor.get_active_segment_id() or ""
                result["selectedSegmentId"] = selected_segment_id
                result["captureSource"] = "segmentation_editor"
                if selected_segment_id:
                    segment_obj = seg_editor.get_segment(selected_segment_id)
                    if segment_obj:
                        result["selectedSegmentName"] = segment_obj.GetName() or ""

                visible_segment_names = []
                for seg_id in seg_editor.get_segment_ids() or []:
                    if seg_editor.get_segment_visibility(seg_id):
                        seg_obj = seg_editor.get_segment(seg_id)
                        if seg_obj:
                            visible_segment_names.append(seg_obj.GetName() or "")
                result["visibleSegmentNames"] = [name for name in visible_segment_names if name]

                # Also inspect Trame state keys that drive UI selection; prefer this if available.
                state_active_segment_id = self._get_active_segment_id_from_server_state()
                if state_active_segment_id:
                    state_segment_obj = seg_editor.get_segment(state_active_segment_id)
                    if state_segment_obj:
                        result["selectedSegmentId"] = state_active_segment_id
                        result["selectedSegmentName"] = state_segment_obj.GetName() or result["selectedSegmentName"]
                        result["captureSource"] = "trame_state_active_segment_id"

            visible_names = []
            segmentation_nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
            for node in segmentation_nodes:
                display_node = node.GetDisplayNode()
                if display_node and display_node.GetVisibility():
                    visible_names.append(node.GetName() or "")
            result["visibleSegmentationNodeNames"] = [name for name in visible_names if name]

            scene = self._get_scene()
            editor_node = scene.GetFirstNodeByClass("vtkMRMLSegmentEditorNode") if scene else None
            if editor_node:
                segmentation_node = editor_node.GetSegmentationNode()
                selected_segment_id = editor_node.GetSelectedSegmentID() or ""
                if segmentation_node and not result["activeSegmentationNodeName"]:
                    result["activeSegmentationNodeName"] = segmentation_node.GetName() or ""
                    result["captureSource"] = "mrml_segment_editor_node"
                    if not result["selectedSegmentId"]:
                        result["selectedSegmentId"] = selected_segment_id
                    if selected_segment_id and not result["selectedSegmentName"]:
                        segment_obj = segmentation_node.GetSegmentation().GetSegment(selected_segment_id)
                        if segment_obj:
                            result["selectedSegmentName"] = segment_obj.GetName() or ""
                if segmentation_node and not result["visibleSegmentNames"]:
                        # Fallback capture when segmentation editor visibility isn't available.
                        display_node = segmentation_node.GetDisplayNode()
                        if display_node:
                            segment_ids = self._new_vtk_string_array()
                            if segment_ids is not None:
                                segmentation_node.GetSegmentation().GetSegmentIDs(segment_ids)
                                visible_segment_names = []
                                for i in range(segment_ids.GetNumberOfValues()):
                                    seg_id = segment_ids.GetValue(i)
                                    if display_node.GetSegmentVisibility(seg_id):
                                        seg_obj = segmentation_node.GetSegmentation().GetSegment(seg_id)
                                        if seg_obj:
                                            visible_segment_names.append(seg_obj.GetName() or "")
                                result["visibleSegmentNames"] = [name for name in visible_segment_names if name]
        except Exception as err:
            print(f"Unable to capture segmentation state: {err}")
        return result

    def _get_active_segment_id_from_server_state(self):
        """Read active segment id from Trame state (UI-bound source), if present."""
        try:
            state = getattr(self._server, "state", None)
            if state is None:
                return ""
            candidates = []
            for key in list(state.keys()):
                key_str = str(key)
                if key_str == "active_segment_id" or key_str.endswith(".active_segment_id"):
                    value = state.get(key)
                    if isinstance(value, str) and value:
                        candidates.append(value)
            return candidates[-1] if candidates else ""
        except Exception:
            return ""

    def _set_active_segment_id_in_server_state(self, segment_id: str):
        """Update Trame UI-bound active segment state keys when available."""
        if not segment_id:
            return
        try:
            state = getattr(self._server, "state", None)
            if state is None:
                return
            updated = False
            for key in list(state.keys()):
                key_str = str(key)
                if key_str == "active_segment_id" or key_str.endswith(".active_segment_id"):
                    state[key] = segment_id
                    updated = True
            if updated:
                state.flush()
        except Exception as err:
            print(f"Unable to sync active_segment_id to server state: {err}")

    def _find_segmentation_node_by_name(self, name: str):
        if not name:
            return None
        try:
            segmentation_nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
            requested = (name or "").strip()
            requested_norm = requested.lower()

            # 1) Exact match.
            for node in segmentation_nodes:
                if (node.GetName() or "") == requested:
                    return node

            # 2) Case-insensitive exact.
            for node in segmentation_nodes:
                node_name = (node.GetName() or "").strip().lower()
                if node_name == requested_norm:
                    return node

            # 3) Prefix-compatible fallback ("Segmentation" vs "Segmentation_1").
            for node in segmentation_nodes:
                node_name_raw = (node.GetName() or "").strip()
                node_name = node_name_raw.lower()
                if node_name.startswith(f"{requested_norm}_") or requested_norm.startswith(f"{node_name}_"):
                    return node
        except Exception:
            return None
        return None

    def _find_segmentation_node_by_segment_names(self, segment_names):
        """Fallback lookup: find a segmentation containing any requested segment name."""
        if not isinstance(segment_names, list) or not segment_names:
            return None
        wanted = {(name or "").strip().lower() for name in segment_names if isinstance(name, str) and name.strip()}
        if not wanted:
            return None
        try:
            import slicer
            segmentation_nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
            for node in segmentation_nodes:
                segmentation = node.GetSegmentation()
                if not segmentation:
                    continue
                segment_ids = self._new_vtk_string_array()
                if segment_ids is None:
                    continue
                segmentation.GetSegmentIDs(segment_ids)
                for i in range(segment_ids.GetNumberOfValues()):
                    seg_id = segment_ids.GetValue(i)
                    seg_obj = segmentation.GetSegment(seg_id)
                    seg_name = (seg_obj.GetName() or "").strip().lower() if seg_obj else ""
                    if seg_name in wanted:
                        return node
        except Exception:
            return None
        return None

    def _list_nodes_by_class(self, class_name: str):
        """Return scene nodes by class using vtk collection APIs (runtime-safe)."""
        try:
            nodes = []
            scene = self._get_scene()
            if scene is None:
                return []
            collection = scene.GetNodesByClass(class_name)
            collection.InitTraversal()
            node = collection.GetNextItemAsObject()
            while node is not None:
                nodes.append(node)
                node = collection.GetNextItemAsObject()
            return nodes
        except Exception:
            return []

    def _get_scene(self):
        """Return the active MRML scene for this app instance."""
        scene = getattr(self._slicer_app, "scene", None)
        if scene is not None:
            return scene
        try:
            import slicer
            return getattr(slicer, "mrmlScene", None)
        except Exception:
            return None

    def _new_vtk_string_array(self):
        """Create vtkStringArray across Slicer runtime variants."""
        try:
            import vtk
            return vtk.vtkStringArray()
        except Exception:
            try:
                import slicer
                return slicer.vtkStringArray()
            except Exception:
                return None

    def _collect_segmentation_debug_snapshot(self, active_node=None):
        """Collect lightweight segmentation debug info for replay diagnostics."""
        snapshot = {
            "segmentationNodeNames": [],
            "activeNodeNameAfterApply": "",
            "activeNodeSegmentIdToName": {},
        }
        try:
            nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
            snapshot["segmentationNodeNames"] = [(node.GetName() or "") for node in nodes]
            if active_node:
                snapshot["activeNodeNameAfterApply"] = active_node.GetName() or ""
                segmentation = active_node.GetSegmentation()
                if segmentation:
                    segment_ids = self._new_vtk_string_array()
                    if segment_ids is not None:
                        segmentation.GetSegmentIDs(segment_ids)
                        mapping = {}
                        for i in range(segment_ids.GetNumberOfValues()):
                            seg_id = segment_ids.GetValue(i)
                            seg_obj = segmentation.GetSegment(seg_id)
                            mapping[seg_id] = (seg_obj.GetName() or "") if seg_obj else ""
                        snapshot["activeNodeSegmentIdToName"] = mapping
        except Exception as err:
            snapshot["snapshotError"] = str(err)
        return snapshot

    def _resolve_segment_id(self, segmentation_node, preferred_id: str, preferred_name: str):
        if not segmentation_node:
            return ""
        segmentation = segmentation_node.GetSegmentation()
        if preferred_id and segmentation.GetSegment(preferred_id):
            return preferred_id
        if preferred_name:
            try:
                segment_ids = self._new_vtk_string_array()
                if segment_ids is None:
                    return ""
            except Exception:
                return ""
            preferred_name_normalized = preferred_name.strip().lower()
            segmentation.GetSegmentIDs(segment_ids)
            for i in range(segment_ids.GetNumberOfValues()):
                candidate_id = segment_ids.GetValue(i)
                segment_obj = segmentation.GetSegment(candidate_id)
                candidate_name = (segment_obj.GetName() or "").strip().lower() if segment_obj else ""
                if candidate_name == preferred_name_normalized:
                    return candidate_id
        return ""

    def _find_best_segmentation_and_segment(self, preferred_node_name: str, preferred_segment_id: str, preferred_segment_name: str, visible_segment_names):
        """
        Resolve the most likely segmentation node + segment id from available cues.
        Priority:
          1) Preferred node + preferred segment id/name
          2) Any node containing preferred segment id/name
          3) Any node containing one of visible segment names
          4) Preferred node only (no segment)
          5) First segmentation node
        """
        all_nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
        preferred_node = self._find_segmentation_node_by_name(preferred_node_name)

        # 1) Preferred node + explicit segment hint.
        if preferred_node:
            seg_id = self._resolve_segment_id(preferred_node, preferred_segment_id, preferred_segment_name)
            if seg_id:
                return preferred_node, seg_id, "preferred_node_with_requested_segment"

        # 2) Search any node for requested id/name.
        for node in all_nodes:
            seg_id = self._resolve_segment_id(node, preferred_segment_id, preferred_segment_name)
            if seg_id:
                return node, seg_id, "any_node_with_requested_segment"

        # 3) Search any node for visible segment hints.
        if isinstance(visible_segment_names, list):
            for seg_name in visible_segment_names:
                for node in all_nodes:
                    seg_id = self._resolve_segment_id(node, "", seg_name)
                    if seg_id:
                        return node, seg_id, "any_node_with_visible_segment_name"

        # 4) Preferred node only.
        if preferred_node:
            return preferred_node, "", "preferred_node_only"

        # 5) First segmentation node.
        if all_nodes:
            return all_nodes[0], "", "first_available_segmentation_node"

        return None, "", "no_segmentation_nodes"

    def _apply_segmentation_state(self, segmentation_state):
        """Replay captured segmentation context into active scene (best effort)."""
        if not isinstance(segmentation_state, dict):
            return {"success": False, "reason": "invalid_segmentation_payload"}
        try:
            import slicer
            active_node_name = segmentation_state.get("activeSegmentationNodeName") or ""
            selected_segment_id = segmentation_state.get("selectedSegmentId") or ""
            selected_segment_name = segmentation_state.get("selectedSegmentName") or ""
            visible_node_names = segmentation_state.get("visibleSegmentationNodeNames") or []
            visible_segment_names = segmentation_state.get("visibleSegmentNames") or []
            details = {
                "activeNodeName": active_node_name,
                "requestedSegmentId": selected_segment_id,
                "requestedSegmentName": selected_segment_name,
                "resolvedSegmentId": "",
                "resolvedFrom": "",
                "attemptedVisibleSegmentNames": visible_segment_names,
                "success": False,
            }

            active_node, pre_resolved_segment_id, node_resolution_source = self._find_best_segmentation_and_segment(
                active_node_name,
                selected_segment_id,
                selected_segment_name,
                visible_segment_names,
            )
            if not active_node:
                details["reason"] = "active_segmentation_node_not_found"
                details["resolvedFrom"] = node_resolution_source
                return details
            details["activeNodeName"] = active_node.GetName() or active_node_name
            if node_resolution_source:
                details["resolvedFrom"] = node_resolution_source

            # Restore coarse visibility intent for segmentation nodes by name.
            all_seg_nodes = self._list_nodes_by_class("vtkMRMLSegmentationNode")
            for node in all_seg_nodes:
                display_node = node.GetDisplayNode()
                if not display_node:
                    continue
                if visible_node_names:
                    display_node.SetVisibility(1 if (node.GetName() or "") in visible_node_names else 0)

            # Re-apply active segmentation + selected segment to Segment Editor.
            applied_segment = False
            if active_node:
                resolved_segment_id = pre_resolved_segment_id or self._resolve_segment_id(active_node, selected_segment_id, selected_segment_name)
                if resolved_segment_id and not details["resolvedFrom"]:
                    details["resolvedFrom"] = "requested_id_or_name"
                if not resolved_segment_id and len(visible_segment_names) == 1:
                    # Fallback: when only one segment was visible during capture, treat it as focused target.
                    resolved_segment_id = self._resolve_segment_id(active_node, "", visible_segment_names[0])
                    if resolved_segment_id:
                        details["resolvedFrom"] = "single_visible_segment_name"
                details["resolvedSegmentId"] = resolved_segment_id

                seg_editor = getattr(self._slicer_app, "segmentation_editor", None)
                if seg_editor:
                    # Ensure the same segmentation context the UI uses is activated before selecting segment.
                    active_volume = getattr(seg_editor, "active_volume_node", None)
                    if active_volume is None:
                        volume_nodes = self._list_nodes_by_class("vtkMRMLScalarVolumeNode")
                        active_volume = volume_nodes[0] if volume_nodes else None
                    try:
                        if active_volume is not None:
                            seg_editor.set_active_segmentation(active_node, active_volume)
                    except Exception as err:
                        print(f"Unable to set active segmentation through segmentation_editor: {err}")

                # Segment-level visibility tends to communicate "focus" most clearly in replay.
                display_node = active_node.GetDisplayNode()
                if display_node:
                    segmentation = active_node.GetSegmentation()
                    segment_ids = self._new_vtk_string_array()
                    if segment_ids is None:
                        details["reason"] = "vtk_string_array_unavailable"
                        return details
                    segmentation.GetSegmentIDs(segment_ids)
                    if visible_segment_names:
                        # Apply exact captured visibility by segment name.
                        visible_name_set = {name.strip().lower() for name in visible_segment_names if isinstance(name, str)}
                        for i in range(segment_ids.GetNumberOfValues()):
                            seg_id = segment_ids.GetValue(i)
                            seg_obj = segmentation.GetSegment(seg_id)
                            seg_name = (seg_obj.GetName() or "").strip().lower() if seg_obj else ""
                            display_node.SetSegmentVisibility(seg_id, seg_name in visible_name_set)
                        applied_segment = True
                    elif resolved_segment_id:
                        for i in range(segment_ids.GetNumberOfValues()):
                            seg_id = segment_ids.GetValue(i)
                            display_node.SetSegmentVisibility(seg_id, seg_id == resolved_segment_id)
                        applied_segment = True
            if selected_segment_id or selected_segment_name:
                details["success"] = bool(applied_segment)
                if not details["success"] and not details["reason"]:
                    details["reason"] = "segment_not_applied"
                details["snapshot"] = self._collect_segmentation_debug_snapshot(active_node)
                return details
            details["success"] = active_node is not None
            if not details["success"] and not details["reason"]:
                details["reason"] = "active_node_missing"
            details["snapshot"] = self._collect_segmentation_debug_snapshot(active_node)
            return details
        except Exception as err:
            print(f"Unable to apply segmentation state: {err}")
            return {"success": False, "reason": "exception", "error": str(err)}

    def _apply_segmentation_state_with_retry(self, segmentation_state, attempts=80, delay_seconds=0.5):
        """Retry segmentation replay to handle late scene + Segment Editor initialization."""
        if not isinstance(segmentation_state, dict):
            return {"success": False, "reason": "invalid_segmentation_payload"}
        last_details = {"success": False, "reason": "not_attempted"}
        for attempt_index in range(attempts):
            last_details = self._apply_segmentation_state(segmentation_state)
            if last_details.get("success"):
                last_details["attempts"] = attempt_index + 1
                return last_details
            time.sleep(delay_seconds)
        print("Segmentation view-state replay did not fully apply after retries")
        last_details["attempts"] = attempts
        if not last_details.get("reason"):
            last_details["reason"] = "max_retries_reached"
        return last_details

    def _start_view_state_request_watcher(self) -> None:
        """Watch for view-state capture requests from session manager in /tmp."""
        request_pattern = "/tmp/trame-view-state-request-*.json"

        def _watch():
            while True:
                try:
                    import glob
                    request_files = glob.glob(request_pattern)
                    for request_file in request_files:
                        req_path = Path(request_file)
                        payload = {}
                        try:
                            payload = json.loads(req_path.read_text())
                        except Exception:
                            payload = {}
                        req_path.unlink(missing_ok=True)

                        request_id = str(payload.get("request_id", "unknown"))
                        result_payload = {
                            "request_id": request_id,
                            "success": True,
                            "view_state": self._capture_view_state(),
                            "error": "",
                        }
                        result_path = Path(f"/tmp/trame-view-state-result-{request_id}.json")
                        result_path.write_text(json.dumps(result_payload))
                except Exception as err:
                    print(f"View-state watcher error: {err}")
                time.sleep(0.5)

        thread = threading.Thread(target=_watch, daemon=True)
        thread.start()

    def _start_apply_view_state_request_watcher(self) -> None:
        """Watch for explicit apply-view-state requests from session manager in /tmp."""
        request_pattern = "/tmp/trame-apply-view-state-request-*.json"

        def _watch():
            while True:
                try:
                    import glob
                    request_files = glob.glob(request_pattern)
                    for request_file in request_files:
                        req_path = Path(request_file)
                        payload = {}
                        try:
                            payload = json.loads(req_path.read_text())
                        except Exception:
                            payload = {}
                        req_path.unlink(missing_ok=True)

                        request_id = str(payload.get("request_id", "unknown"))
                        view_state = payload.get("view_state") or {}
                        apply_result = self._apply_view_state_thread_safe(view_state, wait_timeout_seconds=75.0)
                        applied = bool(apply_result.get("success"))
                        result_payload = {
                            "request_id": request_id,
                            "success": applied,
                            "error": "" if applied else "View-state replay did not fully apply",
                            "debug": apply_result,
                        }
                        result_path = Path(f"/tmp/trame-apply-view-state-result-{request_id}.json")
                        result_path.write_text(json.dumps(result_payload))
                except Exception as err:
                    print(f"Apply view-state watcher error: {err}")
                time.sleep(0.5)

        thread = threading.Thread(target=_watch, daemon=True)
        thread.start()


def main(server=None, **kwargs):
    parser = argparse.ArgumentParser(description="Medical Viewer with Server-Side File Loading")
    parser.add_argument("--file", type=str, help="Path to medical imaging file to load on startup")
    parser.add_argument("--view-state", type=str, help="JSON-encoded initial view state to apply after load")
    parser.add_argument("--host", type=str, default="localhost", help="Server host")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    args, unknown = parser.parse_known_args()
    
    initial_view_state = None
    if args.view_state:
        try:
            initial_view_state = json.loads(args.view_state)
        except Exception:
            initial_view_state = None
    app = CustomMedicalViewer(server, input_file=args.file, view_state=initial_view_state)
    enable_testing(app.server)
    
    # Load file after server is ready
    if args.file:
        @app.server.controller.add("on_server_ready")
        def load_file(**kwargs):
            app.load_input_file()
    
    app.server.start(host=args.host, port=args.port, **kwargs)


if __name__ == "__main__":
    main()

