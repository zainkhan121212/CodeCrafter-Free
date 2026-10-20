#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dune build --build-dir /tmp/ccfree-build-http-server-ocaml
)

exec /tmp/ccfree-build-http-server-ocaml/default/main.exe "$@"
