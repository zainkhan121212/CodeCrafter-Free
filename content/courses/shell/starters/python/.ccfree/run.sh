#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

SCRIPT_DIR="$(dirname "$0")"

# This is done to exclude pwd from the python's path variable
# This prevents accidentally launching a module if it s present inside pwd
PYTHONSAFEPATH=1 PYTHONPATH="$SCRIPT_DIR" exec uv run \
  --project "$SCRIPT_DIR" \
  --quiet \
  -m app.main \
  "$@"