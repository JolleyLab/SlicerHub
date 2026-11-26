# Third-party license notices

Source code in this repository is under **BSD-3-Clause** (`LICENSE` at repo root).

Some **runtime** dependencies use separate terms:

| Notice | Scope |
|--------|--------|
| [NVIDIA-NOTICE.md](./NVIDIA-NOTICE.md) | GPU Docker image (`nvidia/cuda` base, CUDA runtime packages) |
| [../THIRD_PARTY_RUNTIME.md](../THIRD_PARTY_RUNTIME.md) | Overview, package inventory, distribution intent |

### Icons

- **UI icons** in `dev/utils/icons.js` (pencil, info, eye, eye-off) are from
  [Material Icons](https://github.com/google/material-design-icons) by Google,
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- **SlicerWeb extension icons** shown on the Workflows pages belong to each extension's own
  project, under that project's license. The backend fetches the icon each SlicerWeb build lists
  and serves it unchanged to signed-in users (`backend/src/services/extensionIcons.js`), as Slicer's
  Extension Manager displays them.

Open-source application libraries (e.g. trame-slicer, VTK) are governed by their
own licenses on PyPI/GitHub; this folder currently documents **NVIDIA** only
because of container redistribution questions.
