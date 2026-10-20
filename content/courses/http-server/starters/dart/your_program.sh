#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dart compile exe bin/main.dart -o compiled
)

exec ./compiled "$@"
