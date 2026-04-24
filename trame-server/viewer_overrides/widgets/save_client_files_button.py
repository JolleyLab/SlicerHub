from __future__ import annotations

from trame_client.widgets.html import Div
from trame_server import Server

from .control_button import ControlButton


class SaveClientFilesButton(Div):
    def __init__(self, server: Server):
        super().__init__()
        with self:
            ControlButton(
                name="Save scene",
                icon="mdi-content-save",
                click=lambda: server.controller.save_current_scene(),
            )
