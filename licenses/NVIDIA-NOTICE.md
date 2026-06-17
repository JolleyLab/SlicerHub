# NVIDIA runtime licensing notice

This file is for **NVIDIA-owned** components used by the GPU viewer image. It does
not replace reading the official agreements. **Not legal advice.**

## Notice

> This image is derived from NVIDIA CUDA container images. NVIDIA software
> contained in this image remains subject to NVIDIA's Deep Learning Container
> License and other applicable NVIDIA license terms.

The same text is copied into GPU images at build time as
`/usr/share/doc/slicer-web/NOTICE-NVIDIA` (see `trame-server/Dockerfile`).

## Where CUDA enters this project

The GPU session image is built from:

| Item | Value |
|------|--------|
| Dockerfile | `trame-server/Dockerfile` |
| Base image | `nvidia/cuda:12.2.0-runtime-ubuntu22.04` |
| Built tag (default) | `slicer-web-trame:local` (`docker compose build trame-job`) |

CUDA libraries are **not** installed via `apt` in that Dockerfile; they are
inherited from the NVIDIA base image layers, plus packages such as
`cuda-cudart-12-2`, `cuda-libraries-12-2`, `libcublas-12-2`, etc. (see
`THIRD_PARTY_RUNTIME.md` for an inventory).

The **host GPU driver** (`libcuda.so`) is expected on the machine running the
container (e.g. Vast.ai, Docker with NVIDIA Container Toolkit), not inside this
image.

## Official license documents (canonical links)

Read these before **redistributing** a prebuilt GPU container image (Docker Hub,
GHCR, etc.):

1. **NVIDIA Deep Learning Container License** (NGC / container images derived
   from NVIDIA-published Docker images such as `nvidia/cuda`):
   https://developer.nvidia.com/ngc/nvidia-deep-learning-container-license

2. **CUDA Toolkit End User License Agreement** (including **Attachment A** —
   redistributable CUDA library files):
   https://docs.nvidia.com/cuda/eula/index.html  
   Attachment A: https://docs.nvidia.com/cuda/eula/index.html#attachment-a

3. **NVIDIA CUDA Docker images** (registry terms and image documentation):
   https://hub.docker.com/r/nvidia/cuda

4. **Questions on CUDA redistribution** (NVIDIA contact referenced in the EULA):
   nvidia-compute-license-questions@nvidia.com

NVIDIA may update these URLs or terms; use the links above for the current text.

## Including a copy of the license text in this repo

This repository **does not** vendor a full copy of the NVIDIA agreements (they
change and are lengthy). We **do** include:

- This notice file (`licenses/NVIDIA-NOTICE.md`)
- Runtime guidance in [`THIRD_PARTY_RUNTIME.md`](../THIRD_PARTY_RUNTIME.md) at the repo root

If you redistribute a **derivative GPU image**, you are responsible for
compliance with the agreements at the links above (notices, permitted components,
application bundling requirements, etc.).

## Current project distribution intent

See [`THIRD_PARTY_RUNTIME.md`](../THIRD_PARTY_RUNTIME.md): source and build
instructions are published; **prebuilt GPU images** should not be published until
license review is complete.

## Disclaimer

Technical notice only — not legal advice. Consult qualified counsel for
commercial distribution, medical use, or public registry publication.
