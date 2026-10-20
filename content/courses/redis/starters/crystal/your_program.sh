#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  crystal build -o /tmp/ccfree-build-redis-crystal app/main.cr
)

exec /tmp/ccfree-build-redis-crystal "$@"
