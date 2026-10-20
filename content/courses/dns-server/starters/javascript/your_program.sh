#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

NODE_PATH="$(dirname "$0")/node_modules" \
exec node "$(dirname "$0")/app/main.js" "$@"
