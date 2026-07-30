# My Projects Full Slicer ADAPTER image.
#
# Today:  FROM local base built by Dockerfile.base
# Future: FROM a published upstream image, e.g.
#   SLICER_GUI_BASE_IMAGE=ghcr.io/org/slicer-gui-gpu:5.10
#
# Owns only session contract + optional SimplifiedViewer:
#   open-request / busy / ready markers via slicer_session.py
#   launch-slicer.sh that starts Slicer with that poller
ARG SLICER_GUI_BASE_IMAGE=slicer-web-slicer-gui-base:local
FROM ${SLICER_GUI_BASE_IMAGE}

USER root

ARG SLICER_HEART_VIEWER_REPO=
ARG SLICER_HEART_VIEWER_REF=

COPY --chmod=755 launch-slicer.sh /usr/local/bin/launch-slicer.sh
COPY slicer_session.py /usr/local/bin/slicer_session.py
COPY install-slicer-extensions.py /usr/local/bin/install-slicer-extensions.py
COPY novnc/slicer-vnc.html /opt/novnc/slicer-vnc.html

RUN mkdir -p /opt/slicer-modules && \
    if [ -n "${SLICER_HEART_VIEWER_REPO}" ]; then \
      echo "Installing SimplifiedViewer from configured repository"; \
      rm -rf /tmp/SlicerHeartViewer && \
      git clone --depth 1 "${SLICER_HEART_VIEWER_REPO}" /tmp/SlicerHeartViewer; \
      if [ -n "${SLICER_HEART_VIEWER_REF}" ]; then \
        cd /tmp/SlicerHeartViewer && \
        git fetch --depth 1 origin "${SLICER_HEART_VIEWER_REF}" && \
        git checkout "${SLICER_HEART_VIEWER_REF}"; \
      fi; \
      test -f /tmp/SlicerHeartViewer/SimplifiedViewer/SimplifiedViewer.py; \
      cp -R /tmp/SlicerHeartViewer/SimplifiedViewer /opt/slicer-modules/SimplifiedViewer; \
      rm -rf /tmp/SlicerHeartViewer; \
    else \
      echo "SLICER_HEART_VIEWER_REPO not set; skipping bundled SimplifiedViewer"; \
    fi && \
    chown -R slicer:slicer /opt/slicer-modules

# Sandbox + SlicerHeart (Cardiac layouts). Launch may re-ensure on fresh volumes.
USER slicer
RUN mkdir -p /home/slicer/.config /home/slicer/slicer.org \
    && xvfb-run -a /opt/Slicer/Slicer \
        --no-splash \
        --no-main-window \
        --exit-after-startup \
        --python-script /usr/local/bin/install-slicer-extensions.py Sandbox SlicerHeart \
    || (echo "WARNING: Sandbox/SlicerHeart extension install failed during image build" && true)

# Inherit ENTRYPOINT [/usr/local/bin/start.sh] from base.
