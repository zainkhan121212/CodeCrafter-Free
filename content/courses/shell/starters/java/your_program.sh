#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  mvn -q -B package -Ddir=/tmp/ccfree-build-shell-java
)

exec java --enable-native-access=ALL-UNNAMED --enable-preview -jar /tmp/ccfree-build-shell-java/codecrafters-shell.jar "$@"
