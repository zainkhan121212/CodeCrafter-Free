#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  gleam build
  gleam run -m gleescript
)

exec "$(dirname "$0")/main" "$@"
