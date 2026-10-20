#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  zig build
)

exec "$(dirname "$0")"/zig-out/bin/main "$@"
