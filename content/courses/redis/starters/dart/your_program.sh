#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dart pub get
  dart compile exe bin/main.dart -o /tmp/ccfree-build-redis-dart
)

exec /tmp/ccfree-build-redis-dart "$@"
