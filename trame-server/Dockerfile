FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# Environment variables
ENV PYTHONUNBUFFERED=1

# Headless EGL rendering (no display needed)
ENV VTK_USE_X=0
ENV DISPLAY=
ENV LIBGL_ALWAYS_SOFTWARE=0

# Install all system dependencies, Python packages, and viewer_lib in a single
# layer so intermediate caches (apt lists, pip cache, tmp files) are never
# committed to the image.
#
# Removed vs original:
#   git          — not used; wget handles all downloads
#   libxrender1  — X11 render extension; VTK_USE_X=0 means X11 is never used
#   libgl1-mesa-glx — GLX is the X11 OpenGL path; not needed for headless EGL
#
# Kept (potentially removable with testing):
#   libgl1-mesa-dri — Mesa DRI/Gallium driver; VTK's EGL path may still
#                     reference it even when a real GPU is present
RUN apt-get update && apt-get -y upgrade && apt-get install -y \
    python3.10 \
    python3-pip \
    wget \
    libegl1 \
    libegl-mesa0 \
    libgles2 \
    libgl1-mesa-dri \
    libgomp1 \
    && apt-get -y autoremove \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 \
    && pip install --no-cache-dir \
        trame-slicer==1.7.1 \
        PyTurboJPEG \
        https://github.com/KitwareMedical/trame-slicer/releases/download/v1.4.0/vtk_mrml-9.4.0-cp310-cp310-manylinux_2_35_x86_64.whl \
    && mkdir -p /app \
    && wget -q -O /tmp/v1.7.1.tar.gz https://github.com/KitwareMedical/trame-slicer/archive/refs/tags/v1.7.1.tar.gz \
    && tar -xzf /tmp/v1.7.1.tar.gz -C /tmp \
    && cp -r /tmp/trame-slicer-1.7.1/examples/viewer_lib /app/viewer_lib \
    && rm -rf /tmp/v1.7.1.tar.gz /tmp/trame-slicer-1.7.1 \
    && pip cache purge


# Add to Python path so imports work
ENV PYTHONPATH=/app

# Performance tuning
ENV TRAME_INTERACTIVE_QUALITY=10
ENV TRAME_STILL_QUALITY=60
ENV TRAME_MAX_FRAME_RATE=30
ENV TRAME_INTERACTIVE_RATIO=0.5

# Set working directory
WORKDIR /app

# Copy the viewer entrypoint
COPY ./viewer.py /app/viewer.py
COPY ./start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Expose port for Trame
EXPOSE 9000

# Start Xvfb and run the viewer application
CMD ["/app/start.sh"]