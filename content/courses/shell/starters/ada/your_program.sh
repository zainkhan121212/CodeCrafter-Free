#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  alr toolchain --select gnat_external gprbuild
  alr build
)

exec ./bin/main "$@"
