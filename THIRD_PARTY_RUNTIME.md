# Third-Party Runtime Notes

This project is open source, but some deployment/runtime dependencies have separate licenses.

## NVIDIA GPU Runtime Dependency

The GPU-enabled deployment path uses NVIDIA container/runtime components (for example, CUDA runtime base images used by `trame-server`).

- These components are **not** covered by this repository's source code license.
- They are provided under NVIDIA terms.
- Review the NVIDIA container/runtime license terms before redistribution or commercial deployment of GPU images.

Reference shown by runtime logs:

- [NVIDIA Deep Learning Container License](https://developer.nvidia.com/ngc/nvidia-deep-learning-container-license)

## Current Distribution Intent

At this time, the project intent is:

- publish source code and build instructions
- avoid publishing prebuilt GPU images until license/compliance review is complete

## Disclaimer

This document is technical guidance only and not legal advice.
