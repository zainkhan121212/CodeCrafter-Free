#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  stack build
)

exec $(stack path --local-install-root)/bin/codecrafters-grep-exe "$@"
