from trame_client.widgets.html import Div
from trame_server import Server
from .control_button import ControlButton
from .utils import StateId

class SaveClientFilesButton(Div):
    def __init__(self, server: Server):
        super().__init__()
        with self:
            ControlButton(
                name="Save file",
                icon="mdi-folder-open",
                click=self.write_to_volume()
                #click=lambda: server.js_call(ref=files_input_ref, method="click"),
                #v_if=(f"!{StateId.file_loading_busy}",),
            )
    #rhisey eventurally this needs to pass a username property
    def write_to_volume(self) -> None:
        #when this is clicked this should make an api call to a server function
        print("rhisey")
