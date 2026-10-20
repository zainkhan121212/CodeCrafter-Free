#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  go build -o /tmp/ccfree-build-interpreter-go app/*.go
)

exec /tmp/ccfree-build-interpreter-go "$@"
