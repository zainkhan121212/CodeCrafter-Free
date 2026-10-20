#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

cargo build --release --target-dir=/tmp/ccfree-build-claude-code-rust --manifest-path Cargo.toml
