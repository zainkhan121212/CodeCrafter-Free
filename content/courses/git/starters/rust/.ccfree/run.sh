#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec /tmp/ccfree-build-git-rust/release/codecrafters-git "$@"
