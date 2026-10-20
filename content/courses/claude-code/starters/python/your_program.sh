#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

SCRIPT_DIR="$(dirname "$0")"
PYTHONSAFEPATH=1 PYTHONPATH="$SCRIPT_DIR" exec uv run \
  --project "$SCRIPT_DIR" \
  --quiet \
  -m app.main \
  "$@"
