# Third-Party Runtime Notes

This project is open source, but some deployment/runtime dependencies have separate licenses.

## NVIDIA GPU Runtime Dependency

The GPU-enabled deployment path uses NVIDIA container/runtime components (for example, CUDA runtime base images used by `trame-server`).

- These components are **not** covered by this repository's source code license.
- They are provided under NVIDIA terms.
- Review the NVIDIA container/runtime license terms before redistribution or commercial deployment of GPU images.

**Repository notice (links, base image, no vendored license text):** [`licenses/NVIDIA-NOTICE.md`](licenses/NVIDIA-NOTICE.md)

> This image is derived from NVIDIA CUDA container images. NVIDIA software contained in this image remains subject to NVIDIA's Deep Learning Container License and other applicable NVIDIA license terms.

Built GPU images include this notice at `/usr/share/doc/slicer-web/NOTICE-NVIDIA`.

### Base image

| Item | Value |
|------|--------|
| Dockerfile | `trame-server/Dockerfile` |
| Base image | `nvidia/cuda:12.2.0-runtime-ubuntu22.04` |
| Default build tag | `slicer-web-trame:local` (`docker compose build trame-job`) |

### Official NVIDIA license links

- [NVIDIA Deep Learning Container License](https://developer.nvidia.com/ngc/nvidia-deep-learning-container-license) — NGC / container images derived from `nvidia/cuda`
- [CUDA Toolkit EULA](https://docs.nvidia.com/cuda/eula/index.html) — includes [Attachment A](https://docs.nvidia.com/cuda/eula/index.html#attachment-a) (redistributable library files)
- [nvidia/cuda on Docker Hub](https://hub.docker.com/r/nvidia/cuda) — image-specific terms and documentation
- CUDA licensing questions (per EULA): `nvidia-compute-license-questions@nvidia.com`

### Installed CUDA packages (from base image, not Dockerfile)

Debian packages present in the built GPU image include, among others:
`cuda-cudart-12-2`, `cuda-libraries-12-2`, `libcublas-12-2`, `libcufft-12-2`,
`libcurand-12-2`, `libcusparse-12-2`, `libcusolver-12-2`, `libnpp-12-2`,
`cuda-nvrtc-12-2`, `libnvjitlink-12-2`, `libnvjpeg-12-2`, `libcufile-12-2`,
`cuda-opencl-12-2`, `cuda-nvtx-12-2`, `cuda-compat-12-2`. Shared objects live under
`/usr/local/cuda-12.2/targets/x86_64-linux/lib/`. The host GPU driver is **not**
shipped in the image.

## Current Distribution Intent

At this time, the project intent is:

- publish source code and build instructions
- avoid publishing prebuilt GPU images until license/compliance review is complete

## Disclaimer

This document is technical guidance only and not legal advice.
