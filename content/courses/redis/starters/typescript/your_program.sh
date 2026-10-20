#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

exec bun run "$(dirname "$0")/app/main.ts" "$@"
