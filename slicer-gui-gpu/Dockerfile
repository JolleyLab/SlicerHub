# Full 3D Slicer desktop + noVNC + VirtualGL (GPU).
# Upstream: https://github.com/lassoan/SlicerCloudContainers/tree/main/slicer-gui-gpu
FROM nvidia/cuda:12.2.2-cudnn8-devel-ubuntu22.04 AS slicer-base

ENV DEBIAN_FRONTEND=noninteractive
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=all

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    git \
    ca-certificates \
    sudo \
    locales \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-apps \
    x11-utils \
    dbus-x11 \
    xauth \
    tigervnc-standalone-server \
    tigervnc-tools \
    x11-xserver-utils \
    wmctrl \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-pil \
    libx11-6 \
    libxrender1 \
    libxext6 \
    libsm6 \
    libxkbcommon0 \
    libdbus-1-3 \
    libfontconfig1 \
    libxcb-shape0 \
    libxcb-xfixes0 \
    libxcb-xinerama0 \
    libxcb-randr0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcomposite1 \
    libxdamage1 \
    libxcursor1 \
    libxrandr2 \
    libxtst6 \
    libglu1-mesa \
    libvulkan1 \
    vulkan-tools \
    libpulse-mainloop-glib0 \
    libnss3 \
    libasound2 \
    qt5dxcb-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir websockify \
    && mkdir -p /usr/share/vulkan/icd.d \
    && echo '{"file_format_version":"1.0.0","ICD":{"library_path":"libGLX_nvidia.so.0","api_version":"1.3.194"}}' \
    > /usr/share/vulkan/icd.d/nvidia_icd.json

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

RUN useradd -m -s /bin/bash slicer && \
    echo "slicer ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

ENV SLICER_VERSION=5.10.0
WORKDIR /opt

RUN wget -q -O /opt/Slicer-linux-amd64.tar.gz \
    "https://download.slicer.org/download?version=${SLICER_VERSION}&os=linux&stability=release" && \
    tar -xzf /opt/Slicer-linux-amd64.tar.gz -C /opt && \
    SLICER_DIR=$(find /opt -maxdepth 1 -type d -name 'Slicer-*linux-amd64' | head -n 1) && \
    test -n "$SLICER_DIR" && \
    mv "$SLICER_DIR" /opt/Slicer && \
    rm -f /opt/Slicer-linux-amd64.tar.gz

RUN chmod +x /opt/Slicer/Slicer && \
    chown -R slicer:slicer /opt/Slicer

WORKDIR /opt/novnc
RUN git clone --depth 1 https://github.com/novnc/noVNC.git . && \
    git clone --depth 1 https://github.com/novnc/websockify.git utils/websockify && \
    chown -R slicer:slicer /opt/novnc

RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

RUN mkdir -p /home/slicer/.vnc /tmp/.X11-unix /home/slicer/.cloudflared && \
    chmod 1777 /tmp/.X11-unix && \
    chown -R slicer:slicer /home/slicer/.vnc /home/slicer/.cloudflared

RUN apt-get update && apt-get install -y --no-install-recommends \
    xdotool \
    mesa-utils \
    libegl1 \
    libgles2 \
    libxv1 \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://github.com/VirtualGL/virtualgl/releases/download/3.1.1/virtualgl_3.1.1_amd64.deb \
    -O /tmp/virtualgl.deb \
    && dpkg -i /tmp/virtualgl.deb \
    && rm /tmp/virtualgl.deb

USER slicer
WORKDIR /home/slicer

RUN printf '#!/bin/bash\nxsetroot -solid grey\nsleep infinity\n' > /home/slicer/.vnc/xstartup && \
    chmod +x /home/slicer/.vnc/xstartup

COPY --chmod=755 start.sh /usr/local/bin/start.sh
COPY --chmod=755 fix-screen-geometry.sh /usr/local/bin/fix-screen-geometry.sh
COPY --chmod=755 apply-slicer-window-size.sh /usr/local/bin/apply-slicer-window-size.sh
COPY --chmod=755 launch-slicer.sh /usr/local/bin/launch-slicer.sh
COPY slicer_session.py /usr/local/bin/slicer_session.py

EXPOSE 5901 6080

ENTRYPOINT ["/usr/local/bin/start.sh"]
