from __future__ import annotations

from datetime import datetime
from pathlib import Path

from trame_client.widgets.html import Div
from trame_server import Server

from trame_slicer.core import SlicerApp

from .control_button import ControlButton

class SaveClientFilesButton(Div):
    def __init__(self, server: Server, slicer_app: SlicerApp):
        super().__init__()
        self._server = server
        self._slicer_app = slicer_app
        with self:
            ControlButton(
                name="Save scene",
                icon="mdi-content-save",
                click=self.save_scene,
            )

    def save_scene(self) -> None:
        """Save the current scene into the mounted /data volume."""
        output_dir = Path("/data")
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        output_path = output_dir / f"saved-scene-{timestamp}.mrb"

        success = self._slicer_app.io_manager.save_scene(output_path)
        if success:
            print(f"Scene saved successfully: {output_path}")
        else:
            print(f"Failed to save scene: {output_path}")
