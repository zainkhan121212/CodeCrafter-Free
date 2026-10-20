#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec /tmp/ccfree-build-claude-code-rust/release/codecrafters-claude-code "$@"
