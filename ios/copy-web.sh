#!/bin/bash
set -e

# Locate repo root (contains index.html).
# SRCROOT is the directory containing the .xcodeproj file.
# Adjust the relative path here if your project is nested differently.
REPO_ROOT="${SRCROOT}/.."
if [ ! -f "${REPO_ROOT}/index.html" ]; then
    REPO_ROOT="${SRCROOT}/../.."
fi
if [ ! -f "${REPO_ROOT}/index.html" ]; then
    echo "error: [copy-web] Could not find repo root — index.html not found near ${SRCROOT}"
    exit 1
fi

DEST="${BUILT_PRODUCTS_DIR}/${WRAPPER_NAME}/Web"
mkdir -p "$DEST"

# Copy top-level web assets
cp "${REPO_ROOT}/index.html"        "$DEST/"
cp "${REPO_ROOT}/sw.js"             "$DEST/"
cp "${REPO_ROOT}/icon.png"          "$DEST/"
cp "${REPO_ROOT}/pwa-manifest.json" "$DEST/"

# Copy src/ and fonts/ preserving directory structure
rsync -a "${REPO_ROOT}/src/"   "$DEST/src/"
rsync -a "${REPO_ROOT}/fonts/" "$DEST/fonts/"

# bridge.js lives in ios/ (one level above the .xcodeproj)
cp "${SRCROOT}/../bridge.js" "$DEST/"

echo "[copy-web] Done → ${DEST}"
