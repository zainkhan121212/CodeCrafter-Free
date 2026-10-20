#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

SCRIPT_DIR="$(dirname "$0")"
exec php "$SCRIPT_DIR/app/main.php" "$@"
