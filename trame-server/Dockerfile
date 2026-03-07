FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# Environment variables
ENV PYTHONUNBUFFERED=1

# Headless EGL rendering (no display needed)
ENV VTK_USE_X=0
ENV DISPLAY=
ENV LIBGL_ALWAYS_SOFTWARE=0

# Install dependencies
RUN apt-get update && apt-get -y upgrade && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    libxrender1 \
    libegl1 \
    libegl-mesa0 \
    libgles2 \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libgomp1 \
    && apt-get -y autoremove \
    && apt-get clean

# Make python3 the default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1

# Install trame-slicer from PyPI (easy to update version)
# To update: change version number here
RUN pip install trame-slicer==1.7.1

# Install PyTurboJPEG for faster image compression
RUN pip install PyTurboJPEG

# Install vtk-mrml wheel
RUN pip install --no-cache-dir https://github.com/KitwareMedical/trame-slicer/releases/download/v1.4.0/vtk_mrml-9.4.0-cp310-cp310-manylinux_2_35_x86_64.whl

# Download viewer_lib from v1.7.1 release to match the pip installed version
RUN mkdir -p /app && \
    wget -O /tmp/v1.7.1.tar.gz https://github.com/KitwareMedical/trame-slicer/archive/refs/tags/v1.7.1.tar.gz && \
    tar -xzf /tmp/v1.7.1.tar.gz -C /tmp && \
    cp -r /tmp/trame-slicer-1.7.1/examples/viewer_lib /app/viewer_lib && \
    rm -rf /tmp/v1.7.1.tar.gz /tmp/trame-slicer-1.7.1


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