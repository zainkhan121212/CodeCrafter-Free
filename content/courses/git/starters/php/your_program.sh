#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

SCRIPT_DIR="$(dirname "$0")"
exec php "$SCRIPT_DIR/app/main.php" "$@"
