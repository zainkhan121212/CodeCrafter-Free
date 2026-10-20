#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  scala-cli package src/main/scala/ \
    -q --power --assembly --force --server=false --scala-version=3.9.0 \
    --main-class codecrafters_shell.main \
    -o /tmp/ccfree-build-shell-scala
)

exec java -jar /tmp/ccfree-build-shell-scala "$@"
