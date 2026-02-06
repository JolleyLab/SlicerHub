from __future__ import annotations

import argparse
import os

from trame.app import get_server
from trame.app.testing import enable_testing
from trame.decorators import TrameApp
from trame.widgets import vuetify3
from trame_client.widgets.html import Div
from trame_server import Server
from trame_vuetify.ui.vuetify3 import SinglePageLayout

try:
    from widgets import StateId, ToolsStrip
except ModuleNotFoundError:
    from .widgets import StateId, ToolsStrip

from trame_slicer.core import LayoutManager, SlicerApp
from trame_slicer.rca_view import register_rca_factories


@TrameApp()
class MyTrameSlicerApp:
    def __init__(self, server=None, input_file=None):
        self._server = get_server(server, client_type="vue3")
        self._slicer_app = SlicerApp()

        # Register the RCA view creation
        # The registration needs to happen before the UI is populated
        register_rca_factories(self._slicer_app.view_manager, self._server)

        # Create the trame layout manager and initialize it with the default grid configuration
        self._layout_manager = LayoutManager(self._slicer_app.scene, self._slicer_app.view_manager, self._server)

        self._layout_manager.register_layout_dict(LayoutManager.default_grid_configuration())

        # Build the trame UI with the widgets available in the widget package
        self._build_ui()

        # Initialize the state defaults
        self.server.state.setdefault(
            StateId.vr_preset_value,
            "CT-Coronary-Arteries-3",
        )
        default_layout = "Axial Primary"
        self.server.state.setdefault(StateId.current_layout_name, default_layout)

        # Update the layout to the default layout
        self._layout_manager.set_layout(default_layout)

        # Store input file to load after server starts
        self._input_file = input_file

    @property
    def server(self) -> Server:
        return self._server
    
    def load_input_file(self):
        """Load the input file after server has started"""
        if self._input_file and os.path.exists(self._input_file):
            print(f"Loading file: {self._input_file}")
            # Use load_volumes for medical imaging files (.nrrd, .dcm, etc.)
            volumes = self._slicer_app.io_manager.load_volumes(self._input_file)
            
            if volumes:
                print(f"Loaded {len(volumes)} volume(s)")
                # Display the first/largest volume
                volume_node = volumes[0] if len(volumes) == 1 else self._get_largest_volume(volumes)
                
                # Show the volume with the default VR preset
                self._slicer_app.display_manager.show_volume(
                    volume_node,
                    vr_preset=self.server.state[StateId.vr_preset_value],
                    do_reset_views=True,
                )
                print(f"Displaying volume: {volume_node.GetName()}")
            else:
                print("No volumes loaded from file")
    
    def _get_largest_volume(self, volumes):
        """Get the largest volume by bounds"""
        def bounds_volume(v):
            b = [0] * 6
            v.GetImageData().GetBounds(b)
            return (b[1] - b[0]) * (b[3] - b[2]) * (b[5] - b[4])
        
        volumes = sorted(volumes, key=bounds_volume)
        return volumes[-1]

    def _build_ui(self):
        with SinglePageLayout(self._server) as self.ui:
            self.ui.root.theme = "dark"

            # Toolbar
            self.ui.title.set_text("trame Slicer")

            with self.ui.toolbar:
                vuetify3.VSpacer()

            # Main content
            with (
                self.ui.content,
                Div(classes="fill-height d-flex flex-row flex-grow-1"),
            ):
                ToolsStrip(
                    server=self._server,
                    slicer_app=self._slicer_app,
                    layout_manager=self._layout_manager,
                )
                self._layout_manager.initialize_layout_grid(self.ui)


def main(server=None, **kwargs):
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Trame Slicer Medical Viewer")
    parser.add_argument("--file", type=str, help="Path to medical imaging file to load")
    parser.add_argument("--host", type=str, default="localhost", help="Server host")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    args, unknown = parser.parse_known_args()
    
    # Create app with input file
    app = MyTrameSlicerApp(server, input_file=args.file)
    enable_testing(app.server)
    
    # Load file after app is initialized but before server starts
    # This allows the server to start quickly and load the file in the background
    if args.file:
        # Schedule file loading to happen after server is ready
        @app.server.controller.add("on_server_ready")
        def load_file(**kwargs):
            app.load_input_file()
    
    # Start server with parsed arguments
    app.server.start(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
