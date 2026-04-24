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
    
    def __init__(self, server=None, input_file=None):
        self._server = get_server(server, client_type="vue3")
        self._slicer_app = SlicerApp()
        self._input_file = input_file

        # Use the official viewer logic and UI
        self._logic = MedicalViewerLogic(self._server, self._slicer_app)
        self._ui = MedicalViewerUI(self._server, self._logic.layout_manager)
        self._logic.set_ui(self._ui)

        # Add server-side file loading method
        self._register_file_loading()
        self._start_save_request_watcher()

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


def main(server=None, **kwargs):
    parser = argparse.ArgumentParser(description="Medical Viewer with Server-Side File Loading")
    parser.add_argument("--file", type=str, help="Path to medical imaging file to load on startup")
    parser.add_argument("--host", type=str, default="localhost", help="Server host")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    args, unknown = parser.parse_known_args()
    
    app = CustomMedicalViewer(server, input_file=args.file)
    enable_testing(app.server)
    
    # Load file after server is ready
    if args.file:
        @app.server.controller.add("on_server_ready")
        def load_file(**kwargs):
            app.load_input_file()
    
    app.server.start(host=args.host, port=args.port, **kwargs)


if __name__ == "__main__":
    main()

