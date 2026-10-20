#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  clj -T:build
)

exec java -jar /tmp/ccfree-build-redis-clojure/target.jar "$@"
