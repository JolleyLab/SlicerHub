# My Projects Full Slicer ADAPTER image.
#
# Today:  FROM local base built by Dockerfile.base
# Future: FROM a published upstream image, e.g.
#   SLICER_GUI_BASE_IMAGE=ghcr.io/org/slicer-gui-gpu:5.10
#
# Owns session contract + addons from slicer-addons.json:
#   catalog extensions + scripted modules (bootstrap bake).
# Daily updates: host sync into data/slicer-addons (see sync-slicer-addons.py) —
# seats mount that tree; do not rebuild this image for routine extension bumps.
ARG SLICER_GUI_BASE_IMAGE=slicer-web-slicer-gui-base:local
FROM ${SLICER_GUI_BASE_IMAGE}

USER root

# Scripted-module git sources (names match repo_env / ref_env in slicer-addons.json).
# When adding a module, append its ARG lines here and in compose/build scripts.
ARG SLICER_HEART_VIEWER_REPO=
ARG SLICER_HEART_VIEWER_REF=
# Space-separated override for catalog extensions (empty = use slicer-addons.json).
ARG SLICER_EXTENSIONS=

COPY --chmod=755 launch-slicer.sh /usr/local/bin/launch-slicer.sh
COPY slicer_session.py /usr/local/bin/slicer_session.py
COPY slicer_addons.py /usr/local/bin/slicer_addons.py
COPY install-slicer-extensions.py /usr/local/bin/install-slicer-extensions.py
COPY --chmod=755 install-slicer-modules.py /usr/local/bin/install-slicer-modules.py
COPY slicer-addons.json /usr/local/share/slicer-web/slicer-addons.json
COPY novnc/slicer-vnc.html /opt/novnc/slicer-vnc.html

ENV SLICER_ADDONS_FILE=/usr/local/share/slicer-web/slicer-addons.json \
    SLICER_HEART_VIEWER_REPO=${SLICER_HEART_VIEWER_REPO} \
    SLICER_HEART_VIEWER_REF=${SLICER_HEART_VIEWER_REF} \
    SLICER_EXTENSIONS=${SLICER_EXTENSIONS}

RUN mkdir -p /usr/local/share/slicer-web /opt/slicer-modules && \
    python3 /usr/local/bin/install-slicer-modules.py && \
    chown -R slicer:slicer /opt/slicer-modules /usr/local/share/slicer-web

# Catalog extensions from slicer-addons.json (or SLICER_EXTENSIONS). Launch may re-ensure.
USER slicer
RUN mkdir -p /home/slicer/.config /home/slicer/slicer.org \
    && xvfb-run -a /opt/Slicer/Slicer \
        --no-splash \
        --no-main-window \
        --exit-after-startup \
        --python-script /usr/local/bin/install-slicer-extensions.py \
    || (echo "WARNING: catalog extension install failed during image build" && true)

# Inherit ENTRYPOINT [/usr/local/bin/start.sh] from base.
