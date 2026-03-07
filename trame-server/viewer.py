"""
Custom Medical Viewer - extends trame-slicer with server-side file loading
Uses the official trame-slicer viewer UI with minimal modifications
"""

from __future__ import annotations

import argparse
import os

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

