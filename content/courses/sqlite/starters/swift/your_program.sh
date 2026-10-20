#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  swift build -c release
)

exec swift run -c release --skip-build swift-sqlite-challenge "$@"
