#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  cargo build --release --target-dir=/tmp/ccfree-build-redis-rust --manifest-path Cargo.toml
)

exec /tmp/ccfree-build-redis-rust/release/codecrafters-redis "$@"
