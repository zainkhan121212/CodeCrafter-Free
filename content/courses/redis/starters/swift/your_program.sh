#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  .codecrafters/restore_mtimes.sh || true
  .codecrafters/swift_build.sh
  .codecrafters/snapshot_mtimes.sh || true
)

exec /tmp/ccfree-build-redis-swift/release/build-your-own-redis "$@"
