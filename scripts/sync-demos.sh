#!/usr/bin/env bash
# Copy each project's built static demo into demos/<name>/, ready for `quarto render`.
#
#   scripts/sync-demos.sh            # copy the demos as they were last built
#   scripts/sync-demos.sh --build    # rebuild them in their own repos first
#
# Demos are committed here because CI can't reach the (private) project repos.
# Everything under demos/ ends up on the public site, so only add built output
# that is safe to publish: no secrets, keys or private data.
set -euo pipefail

CODE="${CODE_DIR:-$HOME/code/lorcanob}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD=false
[[ "${1:-}" == "--build" ]] && BUILD=true

sync_zip() {  # sync_zip <name> <zip path>
  local name="$1" zip="$2" dest="$ROOT/demos/$1"
  if [[ ! -f "$zip" ]]; then
    echo "skip $name: $zip not found (build it first, or pass --build)" >&2
    return
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  unzip -q "$zip" -d "$dest"
  echo "synced $name -> demos/$name"
}

# snellen: the web version, built by web/build.py into web/dist/site.zip.
if $BUILD; then
  (cd "$CODE/snellen" && uv run python web/build.py)
fi
sync_zip snellen "$CODE/snellen/web/dist/site.zip"

# TODO: add more demos here as other projects get a static build.
