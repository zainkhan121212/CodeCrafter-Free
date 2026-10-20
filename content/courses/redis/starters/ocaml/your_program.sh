#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dune build --build-dir /tmp/ccfree-build-redis-ocaml
)

exec /tmp/ccfree-build-redis-ocaml/default/main.exe "$@"
