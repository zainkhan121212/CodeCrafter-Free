#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  mkdir -p /tmp/ccfree-build-interpreter-odin
  odin build src -out:/tmp/ccfree-build-interpreter-odin/main
)

exec /tmp/ccfree-build-interpreter-odin/main "$@"
