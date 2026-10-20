#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  swift build -c release --build-path /tmp/ccfree-build-interpreter-swift
)

exec swift run -c release --skip-build --build-path /tmp/ccfree-build-interpreter-swift build-your-own-interpreter "$@"
