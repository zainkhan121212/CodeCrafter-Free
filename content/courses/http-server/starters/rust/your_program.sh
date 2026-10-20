#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  cargo build --release --target-dir=/tmp/ccfree-build-http-server-rust --manifest-path Cargo.toml
)

exec /tmp/ccfree-build-http-server-rust/release/codecrafters-http-server "$@"
